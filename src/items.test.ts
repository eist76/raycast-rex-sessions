// ABOUTME: Tests for turning Rex sessions, sesh entries and zoxide directories into one picker list.
// ABOUTME: The integration test reads the real rex, sesh and zoxide on this machine when they're installed.
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  existingSessionId,
  expandPath,
  mergeItems,
  newSessionArgs,
  toRexItem,
  toSeshItems,
  toZoxideItems,
} from "./items";
import { loadItems, runner } from "./cli";

describe("mergeItems", () => {
  const rex = [toRexItem({ session_id: "session:1", label: "chezmoi" }, 3)];
  const sesh = toSeshItems([
    { Name: "chezmoi", Path: "/home/me/.local/share/chezmoi", StartupCommand: "vi ." },
    { Name: "Downloads 📥", Path: "/home/me/Downloads", StartupCommand: "yazi" },
  ]);
  const dirs = toZoxideItems(["/home/me/Downloads", "/home/me/src/app"], "/home/me");

  it("lists open sessions first, then sesh entries, then directories", () => {
    const items = mergeItems(rex, sesh, dirs);
    expect(items.map((i) => i.kind)).toEqual(["rex", "sesh", "dir"]);
  });

  it("hides a sesh entry whose session is already open", () => {
    const titles = mergeItems(rex, sesh, dirs).map((i) => i.title);
    expect(titles.filter((t) => t === "chezmoi")).toHaveLength(1);
  });

  it("hides a directory that a sesh entry already covers", () => {
    const paths = mergeItems(rex, sesh, dirs).map((i) => i.path);
    expect(paths.filter((p) => p === "/home/me/Downloads")).toHaveLength(1);
  });

  it("shows directories with ~ and names their session after the folder", () => {
    const dir = mergeItems([], [], dirs).find((i) => i.path === "/home/me/src/app");
    expect(dir?.title).toBe("~/src/app");
    expect(dir?.label).toBe("app");
  });

  it("gives every item a unique id", () => {
    const ids = mergeItems(rex, sesh, dirs).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("existingSessionId", () => {
  const open = [{ session_id: "session:1", label: "Downloads 📥" }];

  it("finds an open session with the item's label, so picking twice never duplicates", () => {
    const [entry] = toSeshItems([{ Name: "Downloads 📥", Path: "/home/me/Downloads", StartupCommand: "yazi" }]);
    expect(existingSessionId(entry, open)).toBe("session:1");
  });

  it("uses the item's own session id when it already has one", () => {
    expect(existingSessionId(toRexItem({ session_id: "session:9", label: "x" }), open)).toBe("session:9");
  });

  it("returns nothing when no session has that label", () => {
    const [dir] = toZoxideItems(["/home/me/src/app"], "/home/me");
    expect(existingSessionId(dir, open)).toBeUndefined();
  });
});

describe("newSessionArgs", () => {
  it("starts a plain shell in the directory when there is no startup command", () => {
    const [dir] = toZoxideItems(["/home/me/src/app"], "/home/me");
    expect(newSessionArgs(dir, "/opt/homebrew/bin/fish")).toEqual(["new", "app", "-c", "/home/me/src/app", "--json"]);
  });

  it("runs the startup command, then stays in an interactive shell", () => {
    const [entry] = toSeshItems([{ Name: "files", Path: "/home/me/Downloads", StartupCommand: "yazi" }]);
    expect(newSessionArgs(entry, "/bin/zsh")).toEqual([
      "new",
      "files",
      "-c",
      "/home/me/Downloads",
      "--json",
      "--",
      "/bin/zsh",
      "-c",
      "yazi; exec /bin/zsh -l",
    ]);
  });
});

describe("expandPath", () => {
  it("expands a leading ~ in each entry and keeps the order", () => {
    expect(expandPath("~/.local/share/mise/shims:/opt/homebrew/bin:/usr/bin", "/home/me")).toBe(
      "/home/me/.local/share/mise/shims:/opt/homebrew/bin:/usr/bin",
    );
  });
});

function installed(program: string): boolean {
  try {
    execFileSync("/usr/bin/which", [program], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.runIf(installed("rex") && installed("sesh") && installed("zoxide"))("on this machine", () => {
  it("loads real sessions, sesh entries and directories", async () => {
    const run = runner(process.env.PATH ?? "", "rex");
    const items = await loadItems(run, homedir(), true);
    const live = JSON.parse(execFileSync("rex", ["ls", "--json"], { encoding: "utf8" })).sessions;
    expect(items.filter((i) => i.kind === "rex")).toHaveLength(live.length);
    expect(items.every((i) => i.title && i.id)).toBe(true);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });
});
