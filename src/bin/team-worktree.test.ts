// The team worktree program (C104, docs/spec/room.md#worktrees) against a real git repository, a real home folder and a real Claude
// Code configuration file in a temporary folder.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { run, worktreePath } from "./team-worktree";

function setup() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "team-worktree-")));
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

describe("team-worktree add", () => {
  it("creates the worktree outside the repository on the branch of the member and leaves the configuration file unchanged", async () => {
    const { home, repo, git } = setup();
    const result = await run(["add", repo, "dev-1"], home, {});
    const path = worktreePath(home, repo, "dev-1");
    expect(result).toEqual({ root: repo, worktree: path, branch: "dev-1", created: true });
    expect(path.startsWith(join(home, "soksak", "worktrees"))).toBe(true);
    expect(git("worktree", "list", "--porcelain")).toContain(`worktree ${path}`);
    expect(execFileSync("git", ["-C", path, "branch", "--show-current"], { encoding: "utf8" }).trim()).toBe("dev-1");
    expect(config(home)).toEqual({ numStartups: 3, projects: { "/other": { hasTrustDialogAccepted: true } } });
  });

  it("keeps an existing worktree of the member, so a second add changes nothing", async () => {
    const { home, repo } = setup();
    await run(["add", repo, "dev-1"], home, {});
    expect(await run(["add", repo, "dev-1"], home, {})).toMatchObject({ created: false });
  });

  it("refuses a member name outside its form and a relative directory", async () => {
    const { home, repo } = setup();
    await expect(run(["add", repo, "../x"], home, {})).rejects.toThrow("member must match");
    await expect(run(["add", "project", "dev-1"], home, {})).rejects.toThrow("directory must be an absolute path");
  });
});

describe("team-worktree remove", () => {
  it("removes the worktree and deletes the merged branch", async () => {
    const { home, repo, git } = setup();
    await run(["add", repo, "dev-1"], home, {});
    expect(await run(["remove", repo, "dev-1"], home, {})).toMatchObject({ removed: true });
    expect(existsSync(worktreePath(home, repo, "dev-1"))).toBe(false);
    expect(existsSync(dirname(worktreePath(home, repo, "dev-1")))).toBe(false);
    expect(git("branch", "--list", "dev-1")).toBe("");
  });

  it("keeps the folder of the repository while another member has a worktree in it", async () => {
    const { home, repo } = setup();
    await run(["add", repo, "dev-1"], home, {});
    await run(["add", repo, "dev-2"], home, {});
    await run(["remove", repo, "dev-1"], home, {});
    expect(existsSync(worktreePath(home, repo, "dev-2"))).toBe(true);
  });

  it("refuses a worktree with uncommitted changes and keeps it", async () => {
    const { home, repo } = setup();
    await run(["add", repo, "dev-1"], home, {});
    writeFileSync(join(worktreePath(home, repo, "dev-1"), "work.txt"), "x");
    await expect(run(["remove", repo, "dev-1"], home, {})).rejects.toThrow();
    expect(existsSync(worktreePath(home, repo, "dev-1"))).toBe(true);
  });
});

describe("team-worktree trust", () => {
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

describe("team-worktree start", () => {
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
      projects: { [repo]: { hasTrustDialogAccepted: true } },
    });
    expect(config(home)).toEqual({ numStartups: 3, projects: { "/other": { hasTrustDialogAccepted: true } } });
  });

  it("writes each missing value alone and keeps the other members, so any one of the first-start questions is answered", async () => {
    const { home, repo } = setup();
    const account = accountHome(home);
    const maker = join(home, "maker");
    mkdirSync(maker);
    writeFileSync(join(account, ".claude.json"), JSON.stringify({ hasCompletedOnboarding: true, userID: "u", projects: { [repo]: { hasTrustDialogAccepted: true, allowedTools: [] } } }));
    expect(await run(["start", account, repo], home, {})).toEqual({ root: repo, changed: false });
    expect(await run(["start", account, maker], home, {})).toEqual({ root: maker, changed: true });
    expect(JSON.parse(readFileSync(join(account, ".claude.json"), "utf8"))).toEqual({
      hasCompletedOnboarding: true,
      userID: "u",
      projects: { [repo]: { hasTrustDialogAccepted: true, allowedTools: [] }, [maker]: { hasTrustDialogAccepted: true } },
    });
    writeFileSync(join(account, ".claude.json"), JSON.stringify({ projects: { [repo]: { hasTrustDialogAccepted: true } } }));
    expect(await run(["start", account, repo], home, {})).toEqual({ root: repo, changed: true });
    expect(JSON.parse(readFileSync(join(account, ".claude.json"), "utf8")).hasCompletedOnboarding).toBe(true);
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
