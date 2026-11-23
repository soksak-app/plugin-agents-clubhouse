// The team worktree program of the room (docs/spec/room.md#worktrees), which the page runs as the declared program `team-worktree`.
//   team-worktree add <directory> <member>     creates the worktree of the team member and trusts the repository for Claude Code
//   team-worktree remove <directory> <member>  removes the worktree of the team member and deletes its merged branch
//   team-worktree trust                        trusts the project folder, its working directory, for Claude Code
// Each command writes one JSON object on its standard output and exits with 0, or writes its error on its standard error and exits
// with 1. The worktree of a member is `<home>/soksak/worktrees/<repository name>-<hash>/<member>` on the branch `<member>`, outside the
// repository, so the project holds no worktree folder; the hash is the first 8 hexadecimal digits of the SHA-256 of the path of the
// repository, so two repositories with one name keep separate folders.
// Claude Code keeps the trust of a folder in projects[<path>].hasTrustDialogAccepted of its configuration file, keyed by the root of
// the main checkout for a folder in a git repository and by the folder itself otherwise, and a worktree follows that root (Claude Code permissions documentation, "What runs before you trust a folder").
// The program writes that member under the lock of proper-lockfile and replaces the file whole, because Claude Code rewrites the same
// file while it runs.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import lockfile from "proper-lockfile";

const MEMBER = /^[a-z0-9][a-z0-9._-]{0,99}$/;

function git(directory: string, args: string[]): string {
  return execFileSync("git", ["-C", directory, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// The folder whose trust Claude Code reads for the directory: the root of the main checkout in a git repository, else the directory.
export function trustKey(directory: string): string {
  const inside = (() => {
    try {
      return git(directory, ["rev-parse", "--is-inside-work-tree"]) === "true";
    } catch (error) {
      if (/not a git repository/.test(String((error as { stderr?: unknown }).stderr ?? ""))) return false;
      throw error;
    }
  })();
  return inside ? repositoryRoot(directory) : directory;
}

// The root of the main checkout of the repository that holds the directory.
export function repositoryRoot(directory: string): string {
  const common = git(directory, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return basename(common) === ".git" ? dirname(common) : git(directory, ["rev-parse", "--show-toplevel"]);
}

export function worktreePath(home: string, root: string, member: string): string {
  const hash = createHash("sha256").update(root).digest("hex").slice(0, 8);
  return join(home, "soksak", "worktrees", `${basename(root)}-${hash}`, member);
}

// The configuration file of Claude Code: $CLAUDE_CONFIG_DIR/.claude.json, else <home>/.claude.json.
export function claudeConfigFile(home: string, env: NodeJS.ProcessEnv): string {
  return join(env.CLAUDE_CONFIG_DIR || home, ".claude.json");
}

export async function trust(file: string, root: string): Promise<boolean> {
  if (!existsSync(file)) writeFileSync(file, "{}\n", { flag: "wx" });
  const release = await lockfile.lock(file, { retries: { retries: 20, minTimeout: 50, maxTimeout: 500 }, realpath: false });
  try {
    const text = readFileSync(file, "utf8");
    const config = JSON.parse(text) as Record<string, unknown>;
    if (config === null || typeof config !== "object" || Array.isArray(config)) throw new Error(`${file} is not a JSON object`);
    const projects = (config.projects ?? {}) as Record<string, Record<string, unknown>>;
    if (typeof projects !== "object" || Array.isArray(projects)) throw new Error(`${file}: projects is not an object`);
    const key = root.normalize("NFC");
    if (projects[key]?.hasTrustDialogAccepted === true) return false;
    projects[key] = { ...(projects[key] ?? {}), hasTrustDialogAccepted: true };
    config.projects = projects;
    const next = `${file}.soksak-${process.pid}`;
    writeFileSync(next, `${JSON.stringify(config, null, 2)}\n`);
    renameSync(next, file);
    return true;
  } finally {
    await release();
  }
}

function memberOf(member: string | undefined): string {
  if (member === undefined || !MEMBER.test(member)) throw new Error(`member must match ${MEMBER}, got ${JSON.stringify(member)}`);
  return member;
}

export async function run(args: string[], home: string, env: NodeJS.ProcessEnv, cwd: string): Promise<Record<string, unknown>> {
  const [command, directory, member] = args;
  if (command === "trust" && args.length === 1) {
    const key = trustKey(cwd);
    return { root: key, trusted: await trust(claudeConfigFile(home, env), key) };
  }
  if (directory === undefined || !directory.startsWith("/")) throw new Error(`directory must be an absolute path, got ${JSON.stringify(directory)}`);
  const root = repositoryRoot(directory);
  const name = memberOf(member);
  const path = worktreePath(home, root, name);
  if (command === "add") {
    const listed = git(root, ["worktree", "list", "--porcelain"]).split("\n").includes(`worktree ${path}`);
    if (!listed) {
      const branch = git(root, ["branch", "--list", name]) !== "";
      git(root, ["worktree", "add", "-q", ...(branch ? [path, name] : ["-b", name, path])]);
    }
    return { root, worktree: path, branch: name, created: !listed, trusted: await trust(claudeConfigFile(home, env), root) };
  }
  if (command === "remove") {
    git(root, ["worktree", "remove", path]);
    git(root, ["branch", "-d", name]);
    // The folder of the repository goes with its last worktree, so a removal leaves no empty folder behind.
    if (readdirSync(dirname(path)).length === 0) rmdirSync(dirname(path));
    return { root, worktree: path, branch: name, removed: true };
  }
  throw new Error(`command must be add, remove or trust, got ${JSON.stringify(command)}`);
}

if (process.argv[1] !== undefined && /team-worktree(\.mjs)?$/.test(process.argv[1])) {
  run(process.argv.slice(2), homedir(), process.env, process.cwd()).then(
    (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
    (error: unknown) => {
      const stderr = (error as { stderr?: unknown })?.stderr;
      process.stderr.write(`${typeof stderr === "string" && stderr !== "" ? stderr.trim() : String((error as Error)?.message ?? error)}\n`);
      process.exit(1);
    },
  );
}
