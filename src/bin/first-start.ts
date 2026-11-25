// The first start program of the room (docs/spec/room.md#first-start), which the page runs as the declared programs `project-trust` and
// `member-start`.
//   first-start trust <folder>          trusts the folder for Claude Code in the configuration file of the person
//   first-start start <home> <folder>   ends the first-start steps and trusts the folder in the configuration file of an account home
//   first-start worktree <folder> <room> <member>                creates the worktree of a member of a room (docs/spec/room.md#worktrees)
//   first-start remove <root> <room> <member> <integration>      removes that worktree and its merged branch
//   first-start memory <folder>                                   creates the memory of the project in the folder (docs/spec/room.md#memory)
//   first-start root <folder>                                     names the root of the main checkout of the folder, or null outside git
// Each command writes one JSON object on its standard output and exits with 0, or writes its error on its standard error and exits
// with 1.
// Claude Code keeps the trust of a folder in projects[<path>].hasTrustDialogAccepted of its configuration file, keyed by the root of
// the main checkout for a folder in a git repository and by the folder itself otherwise, and a worktree follows that root (Claude Code permissions documentation, "What runs before you trust a folder").
// It keeps the end of its first-start steps, the text style and the security notes, in hasCompletedOnboarding of the same file, and the
// answer of its question whether the Chrome extension is the default browser of a session in claudeInChromeDefaultEnabled
// (docs/spec/room.md#first-start).
// The program writes that member under the lock of proper-lockfile and replaces the file whole, because Claude Code rewrites the same
// file while it runs.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import lockfile from "proper-lockfile";

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

// The configuration file of Claude Code: $CLAUDE_CONFIG_DIR/.claude.json, else <home>/.claude.json.
export function claudeConfigFile(home: string, env: NodeJS.ProcessEnv): string {
  return join(env.CLAUDE_CONFIG_DIR || home, ".claude.json");
}

// The answers of the first-start questions of an account home: the first-start steps are done, and a member keeps browser tools off,
// the answer that the question gives without a choice, because a member uses the browser tab of soksak (docs/spec/room.md#first-start).
const FIRST_START: Array<[string, (value: unknown) => boolean, unknown]> = [
  ["hasCompletedOnboarding", (value) => value === true, true],
  ["claudeInChromeDefaultEnabled", (value) => typeof value === "boolean", false],
];

// Writes the trust of root, and with onboarding the answers of the first-start questions, into the configuration file, each only when it
// is missing. Answers whether the file changed.
export async function prepare(file: string, root: string, onboarding: boolean): Promise<boolean> {
  if (!existsSync(file)) writeFileSync(file, "{}\n", { flag: "wx" });
  const release = await lockfile.lock(file, { retries: { retries: 20, minTimeout: 50, maxTimeout: 500 }, realpath: false });
  try {
    const text = readFileSync(file, "utf8");
    const config = JSON.parse(text) as Record<string, unknown>;
    if (config === null || typeof config !== "object" || Array.isArray(config)) throw new Error(`${file} is not a JSON object`);
    const projects = (config.projects ?? {}) as Record<string, Record<string, unknown>>;
    if (typeof projects !== "object" || Array.isArray(projects)) throw new Error(`${file}: projects is not an object`);
    const key = root.normalize("NFC");
    const trusted = projects[key]?.hasTrustDialogAccepted === true;
    const missing = onboarding ? FIRST_START.filter(([key, answered]) => !answered(config[key])) : [];
    if (trusted && missing.length === 0) return false;
    for (const [key, , answer] of missing) config[key] = answer;
    if (!trusted) projects[key] = { ...(projects[key] ?? {}), hasTrustDialogAccepted: true };
    config.projects = projects;
    const next = `${file}.soksak-${process.pid}`;
    writeFileSync(next, `${JSON.stringify(config, null, 2)}\n`);
    renameSync(next, file);
    return true;
  } finally {
    await release();
  }
}

// A member identifier and a room surface are single path segments and branch name parts.
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

function segment(name: string, value: string | undefined): string {
  if (value === undefined || !SEGMENT.test(value) || value.includes("..")) throw new Error(`${name} must match ${SEGMENT}, got ${JSON.stringify(value)}`);
  return value;
}

// The worktree of a member of a room: outside the repository under the home of the person, so the project holds no worktree folder; the
// hash of the root keeps two repositories of one name apart, and the room keeps two rooms that use one definition apart.
export function worktreePath(home: string, root: string, room: string, member: string): string {
  const hash = createHash("sha256").update(root).digest("hex").slice(0, 8);
  return join(home, "soksak", "worktrees", `${basename(root)}-${hash}`, room, member);
}

function insideGit(directory: string): boolean {
  try {
    return git(directory, ["rev-parse", "--is-inside-work-tree"]) === "true";
  } catch (error) {
    if (/not a git repository/.test(String((error as { stderr?: unknown }).stderr ?? ""))) return false;
    throw error;
  }
}

function addWorktree(home: string, folder: string, room: string, member: string): Record<string, unknown> {
  if (!insideGit(folder)) return { worktree: null };
  const root = repositoryRoot(folder);
  const branch = `clubhouse/${room}/${member}`;
  const path = worktreePath(home, root, room, member);
  let integration: string;
  try {
    integration = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  } catch {
    throw new Error(`the main checkout ${root} is on no branch`);
  }
  git(root, ["worktree", "prune"]);
  const listed = git(root, ["worktree", "list", "--porcelain"]).split("\n\n").some((entry) => entry.split("\n").includes(`worktree ${path}`) && entry.split("\n").includes(`branch refs/heads/${branch}`));
  if (!listed) {
    if (git(root, ["branch", "--list", branch]) !== "") throw new Error(`branch ${branch} exists and is not the worktree of the room`);
    git(root, ["worktree", "add", "-q", "-b", branch, path]);
  }
  return { root, worktree: path, branch, integration };
}

function removeWorktree(home: string, root: string, room: string, member: string, integration: string): Record<string, unknown> {
  const branch = `clubhouse/${room}/${member}`;
  const path = worktreePath(home, root, room, member);
  if (git(path, ["status", "--porcelain"]) !== "") throw new Error(`worktree ${path} has changes that are not committed`);
  try {
    git(root, ["merge-base", "--is-ancestor", branch, integration]);
  } catch {
    throw new Error(`branch ${branch} is not merged into ${integration}`);
  }
  git(root, ["worktree", "remove", path]);
  git(root, ["branch", "-d", branch]);
  // Each folder that the removal leaves empty goes with it, up to the folder soksak of the home.
  for (let folder = dirname(path); folder.startsWith(join(home, "soksak")); folder = dirname(folder)) {
    if (readdirSync(folder).length > 0) break;
    rmdirSync(folder);
  }
  return { root, worktree: path, branch, removed: true };
}

// The memory of a project in the folder .memory of the folder that a member works in, tracked by git (docs/spec/room.md#memory). The
// union merge driver keeps the lines of both branches of the appended index and monthly logs, so their merges do not conflict. The
// program commits the files that it creates or changes, so two members that start the memory in two branches at once merge: the index
// by the union driver and .gitattributes as one identical change; untracked files would refuse the merge.
const UNION_LINES = [".memory/index.md merge=union", ".memory/log/*.md merge=union"];
function memoryOf(folder: string): Record<string, unknown> {
  const memory = join(folder, ".memory");
  const index = join(memory, "index.md");
  const changed: string[] = [];
  mkdirSync(memory, { recursive: true });
  if (!existsSync(index)) {
    writeFileSync(index, "# Memory index\n", { flag: "wx" });
    changed.push(join(".memory", "index.md"));
  }
  if (insideGit(folder)) {
    const attributes = join(folder, ".gitattributes");
    const text = existsSync(attributes) ? readFileSync(attributes, "utf8") : "";
    const missing = UNION_LINES.filter((line) => !text.split("\n").includes(line));
    if (missing.length > 0) {
      appendFileSync(attributes, `${text === "" || text.endsWith("\n") ? "" : "\n"}${missing.join("\n")}\n`);
      changed.push(".gitattributes");
    }
    if (changed.length > 0) {
      git(folder, ["add", "--", ...changed]);
      git(folder, ["commit", "-q", "-m", "chore(memory): Start the memory of the project", "--", ...changed]);
    }
  }
  // The number of lines of the index, which the room compares with its bound.
  const indexLines = readFileSync(index, "utf8").split("\n").filter((line) => line !== "").length;
  return { memory, indexLines };
}

function absolute(name: string, value: string | undefined): string {
  if (value === undefined || !value.startsWith("/")) throw new Error(`${name} must be an absolute path, got ${JSON.stringify(value)}`);
  return value;
}

export async function run(args: string[], home: string, env: NodeJS.ProcessEnv): Promise<Record<string, unknown>> {
  const [command] = args;
  if (command === "trust" && args.length === 2) {
    const key = trustKey(absolute("folder", args[1]));
    return { root: key, trusted: await prepare(claudeConfigFile(home, env), key, false) };
  }
  if (command === "start" && args.length === 3) {
    const config = absolute("configuration folder", args[1]);
    const key = trustKey(absolute("folder", args[2]));
    return { root: key, changed: await prepare(join(config, ".claude.json"), key, true) };
  }
  if (command === "worktree" && args.length === 4) {
    return addWorktree(home, absolute("folder", args[1]), segment("room", args[2]), segment("member", args[3]));
  }
  if (command === "memory" && args.length === 2) return memoryOf(absolute("folder", args[1]));
  if (command === "root" && args.length === 2) {
    const folder = absolute("folder", args[1]);
    return { root: insideGit(folder) ? repositoryRoot(folder) : null };
  }
  if (command === "remove" && args.length === 5) {
    return removeWorktree(home, absolute("root", args[1]), segment("room", args[2]), segment("member", args[3]), args[4]);
  }
  throw new Error(`command must be trust, start, worktree, root, memory or remove, got ${JSON.stringify(command)}`);
}

if (process.argv[1] !== undefined && /first-start(\.mjs)?$/.test(process.argv[1])) {
  run(process.argv.slice(2), homedir(), process.env).then(
    (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
    (error: unknown) => {
      const stderr = (error as { stderr?: unknown })?.stderr;
      process.stderr.write(`${typeof stderr === "string" && stderr !== "" ? stderr.trim() : String((error as Error)?.message ?? error)}\n`);
      process.exit(1);
    },
  );
}
