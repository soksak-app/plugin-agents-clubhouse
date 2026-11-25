// The first start program (docs/spec/room.md#first-start) against a real git repository, a real home folder and a real Claude Code
// configuration file in a temporary folder.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
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
  git("config", "user.name", "t");
  git("config", "user.email", "t@t");
  git("commit", "-q", "--allow-empty", "-m", "init");
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

// C148 (docs/spec/room.md#worktrees): the worktree of a member of a room, on a real repository.
describe("first-start worktree and remove", () => {
  const branch = "clubhouse/tab-1/dev-1";
  const worktreeOf = (home: string, repo: string) => {
    const hash = createHash("sha256").update(repo).digest("hex").slice(0, 8);
    return join(home, "soksak", "worktrees", `project-${hash}`, "tab-1", "dev-1");
  };

  it("creates the worktree on the room branch from the main checkout, names the integration branch, and keeps it when run again", async () => {
    const { home, repo, git } = setup();
    mkdirSync(join(repo, "sub"));
    const worktree = worktreeOf(home, repo);
    const answer = { root: repo, worktree, branch, integration: "main" };
    expect(await run(["worktree", join(repo, "sub"), "tab-1", "dev-1"], home, {})).toEqual(answer);
    expect(git("worktree", "list", "--porcelain")).toContain(`worktree ${worktree}\nHEAD`);
    expect(git("rev-parse", branch)).toBe(git("rev-parse", "main"));
    expect(await run(["worktree", repo, "tab-1", "dev-1"], home, {})).toEqual(answer);
  });

  it("answers no worktree for a folder outside git, and refuses a branch of the room without its worktree and a checkout on no branch", async () => {
    const { home, repo, git } = setup();
    const plain = join(home, "plain");
    mkdirSync(plain);
    expect(await run(["worktree", plain, "tab-1", "dev-1"], home, {})).toEqual({ worktree: null });
    git("branch", branch);
    await expect(run(["worktree", repo, "tab-1", "dev-1"], home, {})).rejects.toThrow(`branch ${branch} exists and is not the worktree of the room`);
    git("branch", "-D", branch);
    git("checkout", "-q", "--detach");
    await expect(run(["worktree", repo, "tab-1", "dev-1"], home, {})).rejects.toThrow(`the main checkout ${repo} is on no branch`);
    await expect(run(["worktree", repo, "tab-1", "../x"], home, {})).rejects.toThrow("member must match");
  });

  it("removes a merged worktree with its branch and its empty folders, and refuses changes and an unmerged branch", async () => {
    const { home, repo, git } = setup();
    const { worktree } = (await run(["worktree", repo, "tab-1", "dev-1"], home, {})) as { worktree: string };
    writeFileSync(join(worktree, "new.txt"), "work");
    await expect(run(["remove", repo, "tab-1", "dev-1", "main"], home, {})).rejects.toThrow(`worktree ${worktree} has changes that are not committed`);
    execFileSync("git", ["-C", worktree, "add", "new.txt"]);
    execFileSync("git", ["-C", worktree, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "work"]);
    await expect(run(["remove", repo, "tab-1", "dev-1", "main"], home, {})).rejects.toThrow(`branch ${branch} is not merged into main`);
    git("merge", "-q", "--ff-only", branch);
    expect(await run(["remove", repo, "tab-1", "dev-1", "main"], home, {})).toEqual({ root: repo, worktree, branch, removed: true });
    expect(git("branch", "--list", branch)).toBe("");
    expect(existsSync(join(home, "soksak", "worktrees"))).toBe(false);
  });
});

describe("first-start root (C148)", () => {
  it("names the root of the main checkout of a folder, from a worktree too, and null outside git", async () => {
    const { home, repo } = setup();
    mkdirSync(join(repo, "sub"));
    expect(await run(["root", join(repo, "sub")], home, {})).toEqual({ root: repo });
    const { worktree } = (await run(["worktree", repo, "tab-1", "dev-1"], home, {})) as { worktree: string };
    expect(await run(["root", worktree], home, {})).toEqual({ root: repo });
    const plain = join(home, "plain");
    mkdirSync(plain);
    expect(await run(["root", plain], home, {})).toEqual({ root: null });
  });
});

// C143-3 (docs/spec/room.md#memory): the memory of a project in the folder of a member, tracked by git with union merges.
describe("first-start memory", () => {
  it("commits the memory in each worktree, so two members that start it at once and append to one monthly log merge without a conflict", async () => {
    const { home, repo, git } = setup();
    const trees: string[] = [];
    for (const member of ["dev-1", "dev-2"]) trees.push(((await run(["worktree", repo, "tab-1", member], home, {})) as { worktree: string }).worktree);
    for (const tree of trees) {
      expect(await run(["memory", tree], home, {})).toEqual({ memory: join(tree, ".memory"), indexLines: 1 });
      expect(await run(["memory", tree], home, {})).toEqual({ memory: join(tree, ".memory"), indexLines: 1 });
      expect(readFileSync(join(tree, ".gitattributes"), "utf8")).toBe(".memory/index.md merge=union\n.memory/log/*.md merge=union\n");
      expect(git("-C", tree, "status", "--porcelain")).toBe("");
    }
    const log = (tree: string, line: string) => {
      mkdirSync(join(tree, ".memory", "log"), { recursive: true });
      appendFileSync(join(tree, ".memory", "log", "2026-11.md"), line);
      appendFileSync(join(tree, ".memory", "index.md"), line);
      git("-C", tree, "add", ".memory");
      git("-C", tree, "commit", "-q", "-m", "log");
    };
    log(trees[0], "## a @one: first\n");
    git("merge", "-q", "--ff-only", "clubhouse/tab-1/dev-1");
    log(trees[1], "## b @two: second\n");
    git("-C", trees[1], "merge", "-q", "--no-edit", "main");
    git("merge", "-q", "--ff-only", "clubhouse/tab-1/dev-2");
    // The union driver keeps the lines of both branches, those of the merging branch first, so the order follows the merges.
    expect(readFileSync(join(repo, ".memory", "log", "2026-11.md"), "utf8").split("\n").sort()).toEqual(["", "## a @one: first", "## b @two: second"]);
    expect(readFileSync(join(repo, ".memory", "index.md"), "utf8").split("\n").sort()).toEqual(["", "# Memory index", "## a @one: first", "## b @two: second"]);
    expect(await run(["memory", repo], home, {})).toEqual({ memory: join(repo, ".memory"), indexLines: 3 });
  });

  it("creates the memory in a folder outside git without .gitattributes", async () => {
    const { home } = setup();
    const plain = join(home, "plain");
    mkdirSync(plain);
    expect(await run(["memory", plain], home, {})).toEqual({ memory: join(plain, ".memory"), indexLines: 1 });
    expect(existsSync(join(plain, ".memory", "index.md"))).toBe(true);
    expect(existsSync(join(plain, ".gitattributes"))).toBe(false);
  });
});

describe("first-start commands", () => {
  it("refuses another command", async () => {
    const { home, repo } = setup();
    await expect(run(["add", repo, "dev-1"], home, {})).rejects.toThrow('command must be trust, start, worktree, root, memory or remove, got "add"');
  });
});
