// ABOUTME: Pure helpers that turn Rex sessions, sesh entries and zoxide directories into picker items.
// ABOUTME: Also builds the rex new arguments for an item and expands ~ in a PATH preference.
import { basename } from "node:path";

export type Kind = "rex" | "sesh" | "dir";

export interface Item {
  id: string;
  kind: Kind;
  title: string;
  /** The label a new session gets, and how an open session is matched. */
  label: string;
  path?: string;
  sessionId?: string;
  startup?: string;
  windows?: number;
}

export interface RexSession {
  session_id: string;
  label: string;
}

export interface SeshEntry {
  Name: string;
  Path: string;
  StartupCommand?: string;
}

export function toRexItem(session: RexSession, windows?: number): Item {
  return {
    id: `rex:${session.session_id}`,
    kind: "rex",
    title: session.label,
    label: session.label,
    sessionId: session.session_id,
    windows,
  };
}

export function toSeshItems(entries: SeshEntry[]): Item[] {
  return entries.map((entry) => ({
    id: `sesh:${entry.Name}`,
    kind: "sesh",
    title: entry.Name,
    label: entry.Name,
    path: entry.Path,
    startup: entry.StartupCommand || undefined,
  }));
}

export function toZoxideItems(dirs: string[], home: string): Item[] {
  return dirs.map((dir) => ({
    id: `dir:${dir}`,
    kind: "dir",
    title: dir === home || dir.startsWith(`${home}/`) ? `~${dir.slice(home.length)}` : dir,
    label: basename(dir) || dir,
    path: dir,
  }));
}

const trimSlash = (path?: string) => path?.replace(/\/+$/, "");

/** Open sessions first; sesh entries and directories that would duplicate them are left out. */
export function mergeItems(rex: Item[], sesh: Item[], dirs: Item[]): Item[] {
  const openLabels = new Set(rex.map((i) => i.label));
  const visibleSesh = sesh.filter((i) => !openLabels.has(i.label));
  const seshPaths = new Set(sesh.map((i) => trimSlash(i.path)));
  const visibleDirs = dirs.filter((i) => !seshPaths.has(trimSlash(i.path)));
  const seen = new Set<string>();
  return [...rex, ...visibleSesh, ...visibleDirs].filter((i) => !seen.has(i.id) && seen.add(i.id));
}

/** The open session an item refers to: its own, or one already created with its label. */
export function existingSessionId(item: Item, open: RexSession[]): string | undefined {
  return item.sessionId ?? open.find((session) => session.label === item.label)?.session_id;
}

/** Arguments for `rex new`; a startup command runs first and then leaves an interactive shell. */
export function newSessionArgs(item: Item, shell: string): string[] {
  const args = ["new", item.label, "-c", item.path ?? "", "--json"];
  if (item.startup) {
    args.push("--", shell, "-c", `${item.startup}; exec ${shell} -l`);
  }
  return args;
}

export function expandPath(searchPath: string, home: string): string {
  return searchPath
    .split(":")
    .map((entry) => (entry === "~" || entry.startsWith("~/") ? home + entry.slice(1) : entry))
    .join(":");
}
