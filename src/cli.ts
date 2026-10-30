// ABOUTME: Runs rex, sesh and zoxide with an explicit PATH and loads the picker items from them.
// ABOUTME: Local and remote Rex sessions are joined; one unreachable host becomes a visible warning.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  existingSessionId,
  Item,
  LoadedItems,
  mergeItems,
  newSessionArgs,
  RexHosts,
  RexSession,
  SeshEntry,
  toRexItem,
  toSeshItems,
  toTabSummaries,
  toZoxideItems,
} from "./items";

const execFileAsync = promisify(execFile);

export type Run = (program: string, args: string[]) => Promise<string>;

/** A runner that finds sesh and zoxide on searchPath and calls rex at rexPath. */
export function runner(searchPath: string, rexPath: string): Run {
  return async (program, args) => {
    const file = program === "rex" ? rexPath : program;
    const { stdout } = await execFileAsync(file, args, {
      env: { ...process.env, PATH: searchPath },
      timeout: 15_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function warningText(warning: unknown): string {
  if (typeof warning === "string") return warning;
  if (warning && typeof warning === "object" && "message" in warning) {
    const message = (warning as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return JSON.stringify(warning);
}

/** Global Rex flags that keep remote work from starting a local server. */
function serverArgs(server?: string): string[] {
  return server ? ["--server", server, "--autostart=false"] : ["--autostart=false"];
}

async function rawSessions(run: Run, server?: string): Promise<RexSession[]> {
  const parsed = JSON.parse(await run("rex", [...serverArgs(server), "ls", "--json"])) as {
    sessions?: RexSession[];
  };
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("sessions" in parsed) ||
    (parsed.sessions != null && !Array.isArray(parsed.sessions))
  ) {
    throw new Error("Invalid Rex session list response");
  }
  return (parsed.sessions ?? []).map((session) => ({ ...session, server }));
}

async function rexSessions(run: Run, server?: string): Promise<Item[]> {
  const sessions = await rawSessions(run, server);
  return mapLimited(sessions, 4, async (session) => {
    try {
      const view = JSON.parse(
        await run("rex", [
          ...serverArgs(server),
          "api",
          "call",
          "session.view",
          JSON.stringify({ session_id: session.session_id }),
        ]),
      ) as { session_id?: unknown; windows?: unknown; active_window_id?: unknown } | null;
      if (
        !view ||
        Array.isArray(view) ||
        typeof view !== "object" ||
        (view.windows != null && !Array.isArray(view.windows)) ||
        (view.session_id != null && view.session_id !== session.session_id)
      ) {
        throw new Error("Invalid session view response");
      }
      // A session with no windows is valid; Rex may omit `windows` or send null.
      const windows = Array.isArray(view.windows) ? view.windows : [];
      const tabs = toTabSummaries(view.windows, view.active_window_id);
      if (tabs.length !== windows.length) throw new Error("Invalid windows in session view");
      return toRexItem(session, windows.length, server, tabs);
    } catch {
      return toRexItem(session, undefined, server);
    }
  });
}

/** Host labels from `rex hosts --json`, in the order Rex lists them. */
async function remoteHosts(run: Run): Promise<{ labels: string[]; warnings: string[] }> {
  let parsed: RexHosts;
  try {
    parsed = JSON.parse(await run("rex", ["hosts", "--json"])) as RexHosts;
  } catch (error) {
    // Only an explicitly unsupported command is a compatibility fallback. A timeout,
    // unavailable home, or malformed response must not look like an empty host list.
    if (/unknown command ["']hosts["']/i.test(errorText(error))) return { labels: [], warnings: [] };
    return { labels: [], warnings: [`Couldn't discover Rex hosts: ${errorText(error)}`] };
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("hosts" in parsed) ||
    (parsed.hosts != null && !Array.isArray(parsed.hosts)) ||
    (parsed.warnings != null && !Array.isArray(parsed.warnings))
  ) {
    return { labels: [], warnings: ["Couldn't discover Rex hosts: invalid host list response"] };
  }
  const labels: string[] = [];
  for (const entry of parsed.hosts ?? []) {
    const label = entry.host?.label?.trim();
    if (label && !labels.includes(label)) labels.push(label);
  }
  return { labels, warnings: (parsed.warnings ?? []).map(warningText) };
}

async function remoteSessions(run: Run): Promise<{ items: Item[]; warnings: string[]; hosts: string[] }> {
  const { labels, warnings } = await remoteHosts(run);
  const results = await Promise.all(
    labels.map(async (label) => {
      try {
        return { items: await rexSessions(run, label), warning: undefined };
      } catch (error) {
        return { items: [], warning: `Couldn't list sessions on ${label}: ${errorText(error)}` };
      }
    }),
  );
  const items = results.flatMap((result) => result.items);
  const failures = results.flatMap((result) => (result.warning ? [result.warning] : []));
  return { items, warnings: [...warnings, ...failures], hosts: labels };
}

async function seshEntries(run: Run): Promise<Item[]> {
  try {
    return toSeshItems((JSON.parse(await run("sesh", ["list", "-c", "--json"])) as SeshEntry[] | null) ?? []);
  } catch {
    return [];
  }
}

async function zoxideDirs(run: Run, home: string): Promise<Item[]> {
  try {
    const dirs = (await run("zoxide", ["query", "-l"])).split("\n").filter(Boolean);
    return toZoxideItems(dirs, home);
  } catch {
    return [];
  }
}

/** Bound view requests per host while retaining Rex's session order. */
async function mapLimited<T, U>(items: T[], limit: number, visit: (item: T) => Promise<U>): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await visit(items[index]);
      }
    }),
  );
  return results;
}

// A command keeps its runner stable. Manual refresh, host retry and polling then
// share an active load instead of launching duplicate child processes.
const activeLoads = new WeakMap<Run, Map<string, Promise<LoadedItems>>>();
export function loadItems(
  run: Run,
  home: string,
  includeZoxide: boolean,
  includeRemote = true,
  includeSesh = false,
): Promise<LoadedItems> {
  let loads = activeLoads.get(run);
  if (!loads) {
    loads = new Map();
    activeLoads.set(run, loads);
  }
  const key = JSON.stringify([home, includeZoxide, includeRemote, includeSesh]);
  const active = loads.get(key);
  if (active) return active;
  const promise = loadItemsUncached(run, home, includeZoxide, includeRemote, includeSesh).finally(() =>
    loads.delete(key),
  );
  loads.set(key, promise);
  return promise;
}

/**
 * Rex sessions are required; sesh and zoxide are optional and quietly left out when missing.
 * A host that cannot be reached is reported instead of hiding the rest of the list.
 */
async function loadItemsUncached(
  run: Run,
  home: string,
  includeZoxide: boolean,
  includeRemote = true,
  includeSesh = false,
): Promise<LoadedItems> {
  const local = rexSessions(run).then(
    (items) => ({ items, warnings: [] as string[] }),
    (error) => ({ items: [] as Item[], warnings: [`Couldn't list local Rex sessions: ${errorText(error)}`] }),
  );
  const remote = includeRemote ? remoteSessions(run) : Promise.resolve({ items: [], warnings: [], hosts: [] });
  const [rexLocal, rexRemote, sesh, dirs] = await Promise.all([
    local,
    remote,
    includeSesh ? seshEntries(run) : Promise.resolve([]),
    includeZoxide ? zoxideDirs(run, home) : Promise.resolve([]),
  ]);
  return {
    hosts: rexRemote.hosts,
    items: mergeItems([...rexLocal.items, ...rexRemote.items], sesh, dirs),
    warnings: [...rexLocal.warnings, ...rexRemote.warnings],
  };
}

/** Show the item's session in the Rex app, creating it first when it isn't open. */
export async function connect(run: Run, item: Item, shell: string): Promise<void> {
  if (item.server) {
    // The local app is connected to the configured hosts too, so it can select the remote
    // session by ID. Running `rex --server HOST do` would target that host's own app instead.
    if (!item.sessionId) throw new Error(`Remote session ${item.label} has no session ID`);
    await run("rex", ["do", "session.select", `session_id=${item.sessionId}`]);
    return;
  }
  // The list may be stale, so check the live sessions before creating one.
  const sessions = await rawSessions(run);
  let sessionId = existingSessionId(item, sessions);
  if (!sessionId) {
    const created = JSON.parse(await run("rex", newSessionArgs(item, shell))) as { session_id: string };
    sessionId = created.session_id;
  }
  await run("rex", ["do", "session.select", `session_id=${sessionId}`]);
}

/** Show one tab of a session in the Rex app, including a tab on a remote host. */
export async function selectTab(run: Run, sessionId: string, windowId: string): Promise<void> {
  await run("rex", ["do", "session.select", `session_id=${sessionId}`, `window_id=${windowId}`]);
}

export async function killSession(run: Run, item: Item): Promise<void> {
  if (!item.sessionId) return;
  const args = item.server
    ? ["--server", item.server, "--autostart=false", "kill", item.sessionId]
    : ["kill", item.sessionId];
  await run("rex", args);
}
