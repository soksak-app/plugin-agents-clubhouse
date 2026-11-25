// The first start program (docs/spec/room.md#first-start) against a real git repository, a real home folder and a real Claude Code
// configuration file in a temporary folder.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "./first-start";

function setup() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "first-start-")));
  const home = join(base, "home");
  const repo = join(base, "project");
  mkdirSync(home);
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
  writeFileSync(join(home, ".claude.json"), JSON.stringify({ numStartups: 3, projects: { "/other": { hasTrustDialogAccepted: true } } }));
  return { home, repo, git };
}

const config = (home: string) => JSON.parse(readFileSync(join(home, ".claude.json"), "utf8"));

describe("first-start trust", () => {
  it("trusts the root of the main checkout for a folder inside the repository, under CLAUDE_CONFIG_DIR when it is set", async () => {
    const { home, repo } = setup();
    mkdirSync(join(repo, "sub"));
    const dir = join(home, "cfg");
    mkdirSync(dir);
    expect(await run(["trust", join(repo, "sub")], home, { CLAUDE_CONFIG_DIR: dir })).toEqual({ root: repo, trusted: true });
    expect(JSON.parse(readFileSync(join(dir, ".claude.json"), "utf8"))).toEqual({ projects: { [repo]: { hasTrustDialogAccepted: true } } });
  });

  it("trusts a folder outside every git repository by its own path and refuses a relative folder", async () => {
    const { home } = setup();
    const plain = join(home, "plain");
    mkdirSync(plain);
    expect(await run(["trust", plain], home, {})).toEqual({ root: plain, trusted: true });
    expect(config(home).projects[plain]).toEqual({ hasTrustDialogAccepted: true });
    await expect(run(["trust", "plain"], home, {})).rejects.toThrow("folder must be an absolute path");
  });
});

describe("first-start start", () => {
  // The configuration folder of an account home as the agents plugin creates it: an empty folder (agents docs/spec/definitions.md#account-homes).
  function accountHome(base: string): string {
    const folder = join(base, "accounts", "claude-main");
    mkdirSync(folder, { recursive: true });
    return folder;
  }

  it("ends the first-start steps and trusts the folder in the configuration file of the account home, not of the person", async () => {
    const { home, repo } = setup();
    const account = accountHome(home);
    expect(await run(["start", account, repo], home, {})).toEqual({ root: repo, changed: true });
    expect(JSON.parse(readFileSync(join(account, ".claude.json"), "utf8"))).toEqual({
      hasCompletedOnboarding: true,
      claudeInChromeDefaultEnabled: false,
      projects: { [repo]: { hasTrustDialogAccepted: true } },
    });
    expect(config(home)).toEqual({ numStartups: 3, projects: { "/other": { hasTrustDialogAccepted: true } } });
  });

  it("writes each missing value alone and keeps the other members, so any one of the first-start questions is answered", async () => {
    const { home, repo } = setup();
    const account = accountHome(home);
    const maker = join(home, "maker");
    mkdirSync(maker);
    writeFileSync(join(account, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true, claudeInChromeDefaultEnabled: true, userID: "u", projects: { [repo]: { hasTrustDialogAccepted: true, allowedTools: [] } } }));
    expect(await run(["start", account, repo], home, {})).toEqual({ root: repo, changed: false });
    expect(await run(["start", account, maker], home, {})).toEqual({ root: maker, changed: true });
    expect(JSON.parse(readFileSync(join(account, ".claude.json"), "utf8"))).toEqual({
      hasCompletedOnboarding: true,
      claudeInChromeDefaultEnabled: true,
      userID: "u",
      projects: { [repo]: { hasTrustDialogAccepted: true, allowedTools: [] }, [maker]: { hasTrustDialogAccepted: true } },
    });
    writeFileSync(join(account, ".claude.json"), JSON.stringify({ projects: { [repo]: { hasTrustDialogAccepted: true } } }));
    expect(await run(["start", account, repo], home, {})).toEqual({ root: repo, changed: true });
    expect(JSON.parse(readFileSync(join(account, ".claude.json"), "utf8"))).toMatchObject({ hasCompletedOnboarding: true, claudeInChromeDefaultEnabled: false });
  });

  it("refuses a relative configuration folder or folder and a configuration file that is not a JSON object", async () => {
    const { home, repo } = setup();
    const account = accountHome(home);
    await expect(run(["start", "accounts", repo], home, {})).rejects.toThrow("configuration folder must be an absolute path");
    await expect(run(["start", account, "project"], home, {})).rejects.toThrow("folder must be an absolute path");
    writeFileSync(join(account, ".claude.json"), "[]");
    await expect(run(["start", account, repo], home, {})).rejects.toThrow(`${join(account, ".claude.json")} is not a JSON object`);
  });
});

// C144 (docs/spec/room.md#leader): the room creates no worktree, so the program takes only trust and start.
describe("first-start commands", () => {
  it("refuses add and remove", async () => {
    const { home, repo } = setup();
    await expect(run(["add", repo, "dev-1"], home, {})).rejects.toThrow('command must be trust or start, got "add"');
    await expect(run(["remove", repo, "dev-1"], home, {})).rejects.toThrow('command must be trust or start, got "remove"');
  });
});
