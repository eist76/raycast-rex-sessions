// ABOUTME: Runs rex, sesh and zoxide with an explicit PATH and loads the picker items from them.
// ABOUTME: Kept free of Raycast APIs so the same code runs under tests and inside the extension.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  existingSessionId,
  Item,
  mergeItems,
  newSessionArgs,
  RexSession,
  SeshEntry,
  toRexItem,
  toSeshItems,
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

async function rexSessions(run: Run): Promise<Item[]> {
  const { sessions } = JSON.parse(await run("rex", ["--autostart=false", "ls", "--json"])) as {
    sessions: RexSession[];
  };
  return Promise.all(
    sessions.map(async (session) => {
      try {
        const view = JSON.parse(
          await run("rex", ["api", "call", "session.view", JSON.stringify({ session_id: session.session_id })]),
        ) as { windows: unknown[] };
        return toRexItem(session, view.windows.length);
      } catch {
        return toRexItem(session);
      }
    }),
  );
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

/** Rex sessions are required; sesh and zoxide are optional and quietly left out when missing. */
export async function loadItems(run: Run, home: string, includeZoxide: boolean): Promise<Item[]> {
  const [rex, sesh, dirs] = await Promise.all([
    rexSessions(run),
    seshEntries(run),
    includeZoxide ? zoxideDirs(run, home) : Promise.resolve([]),
  ]);
  return mergeItems(rex, sesh, dirs);
}

/** Show the item's session in the Rex app, creating it first when it isn't open. */
export async function connect(run: Run, item: Item, shell: string): Promise<void> {
  // The list may be stale, so check the live sessions before creating one.
  const { sessions } = JSON.parse(await run("rex", ["--autostart=false", "ls", "--json"])) as {
    sessions: RexSession[];
  };
  let sessionId = existingSessionId(item, sessions);
  if (!sessionId) {
    const created = JSON.parse(await run("rex", newSessionArgs(item, shell))) as { session_id: string };
    sessionId = created.session_id;
  }
  await run("rex", ["do", "session.select", `session_id=${sessionId}`]);
}

export async function killSession(run: Run, item: Item): Promise<void> {
  if (item.sessionId) {
    await run("rex", ["kill", item.sessionId]);
  }
}
