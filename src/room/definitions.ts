// The agent definitions of the room, read from the stored project data of the agents plugin (agents docs/spec/definitions.md): the key
// definitions holds each definition with {name, account, plugin, role, cwd}, and the key accounts holds each account with {id, cli, args,
// env, home}. Program and args are not stored: they are the cli and args of the account of the definition, resolved here with the rule of
// the agents plugin, and an account with a home starts its cli through env in that home (agents docs/spec/definitions.md#resolution). The room names no plugin in its code; plugin comes from each definition. A stored value of another form is refused with
// an explicit error that names the agents project data and the key.
import { memberLaunch } from "./isolation";
import type { MemberDefinition } from "./summon";

export interface AgentDefinition {
  id: string;
  name: string;
  account: string;
  plugin: string;
  program: string;
  args: string[];
  // The configuration home of the account, {variable, folder}, or null for an account without one.
  home: { variable: string; folder: string } | null;
  // The launch of a definition that a maker group listed: the arguments and variables of a session of the maker folder, or null.
  launch: { args: string[]; env: Record<string, string> } | null;
  role: string;
  cwd: string;
}

// Reads the key of the agents plugin through get; the room passes the read of runtime.data.get with plugin agents (F1075).
export type AgentDataGet = (key: string) => Promise<unknown>;

const WHERE = "agents project data";
const DEFINITION_MEMBERS = ["account", "cwd", "name", "plugin", "role"];
// The agents plugin stores maker with launch on a definition that the listing of a maker group stored (agents docs/spec/definitions.md).
const DEFINITION_OPTIONAL = ["maker", "launch"];
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

// Whether a value is {args, env}: args a list of text and env an object of variable name to text.
function isLaunch(value: unknown): value is { args: string[]; env: Record<string, string> } {
  return isRecord(value) && sameMembers(value, ["args", "env"]) && Array.isArray(value.args) && value.args.every((arg) => typeof arg === "string")
    && isRecord(value.env) && Object.entries(value.env).every(([name, text]) => VARIABLE.test(name) && typeof text === "string");
}
const ACCOUNT_MEMBERS = ["args", "cli", "env", "home", "id"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameMembers(record: Record<string, unknown>, members: string[]): boolean {
  const keys = Object.keys(record).sort();
  return keys.length === members.length && keys.every((key, i) => key === members[i]);
}

// Reads the definitions and the accounts, and resolves each definition with the program and arguments of its account, in the code
// point order of its identifier. An absent key reads as no definitions and no accounts.
// The names that a mention or a section heading reserves (docs/spec/room.md#mentions), compared without case.
const RESERVED = ["all", "owner", "clubhouse"];

// A definition whose name or identifier is reserved is refused through report, and the other definitions stay.
export async function readAgentDefinitions(get: AgentDataGet, report: (text: string) => void): Promise<AgentDefinition[]> {
  const stored = (await get("definitions")) ?? {};
  const accounts = (await get("accounts")) ?? [];
  if (!isRecord(stored)) throw new Error(`${WHERE} definitions: the value is not an object of definition identifier to {name, account, plugin, role, cwd}`);
  if (!Array.isArray(accounts)) throw new Error(`${WHERE} accounts: the value is not a list of accounts`);
  accounts.forEach((account, index) => {
    if (!isRecord(account) || !sameMembers(account, ACCOUNT_MEMBERS)) {
      throw new Error(`${WHERE} accounts: account ${index} must have the members id, cli, args, env and home only`);
    }
    const home = account.home;
    if (home !== null && !(isRecord(home) && sameMembers(home, ["folder", "variable"]) && typeof home.variable === "string" && typeof home.folder === "string")) {
      throw new Error(`${WHERE} accounts: account ${index} home must be null or {variable, folder}`);
    }
  });
  const definitions = Object.keys(stored).sort().map((id) => {
    const record = stored[id];
    const required = isRecord(record) ? Object.keys(record).filter((key) => !DEFINITION_OPTIONAL.includes(key)) : [];
    const shaped = isRecord(record) && sameMembers(Object.fromEntries(required.map((key) => [key, record[key]])), DEFINITION_MEMBERS);
    const texts = shaped && Object.entries(record).every(([key, value]) => key === "launch" || typeof value === "string");
    if (!shaped || !texts || Object.hasOwn(record, "maker") !== Object.hasOwn(record, "launch")) {
      throw new Error(`${WHERE} definitions: definition ${id} must have the members account, cwd, name, plugin and role, and maker with launch or neither`);
    }
    if (Object.hasOwn(record, "launch") && !isLaunch(record.launch)) {
      throw new Error(`${WHERE} definitions: definition ${id} launch must be {args, env} with args a list of text and env an object of variable name to text`);
    }
    const account = (accounts as Record<string, unknown>[]).find((entry) => entry.id === record.account);
    if (account === undefined) throw new Error(`${WHERE}: definition ${id} uses account ${String(record.account)} that is not defined`);
    return {
      id,
      name: record.name as string,
      account: record.account as string,
      plugin: record.plugin as string,
      program: account.cli as string,
      args: [...(account.args as string[])],
      home: account.home === null ? null : { ...(account.home as { variable: string; folder: string }) },
      launch: isLaunch(record.launch) ? { args: [...record.launch.args], env: { ...record.launch.env } } : null,
      role: record.role as string,
      cwd: record.cwd as string,
    };
  });
  return definitions.filter((definition) => {
    const reserved = [definition.id, definition.name].find((name) => RESERVED.includes(name.toLowerCase()));
    if (reserved !== undefined) report(`${WHERE} definitions: definition ${definition.id} uses the reserved name ${reserved}`);
    return reserved === undefined;
  });
}

// The flag of each program that accepts every request without asking, with the flags of the same meaning: the room starts a program
// without a shell, so an alias or a shell function of the person that adds such a flag does not apply, and Codex refuses a repeated
// --yolo (docs/spec/room.md#accept-all).
const ACCEPT_ALL: Record<string, { add: string; same: string[] }> = {
  claude: { add: "--dangerously-skip-permissions", same: ["--dangerously-skip-permissions"] },
  codex: { add: "--yolo", same: ["--yolo", "--dangerously-bypass-approvals-and-sandbox"] },
};

// The arguments that the setting acceptAll adds for the program: none when the arguments hold a flag of the same meaning.
export function acceptAllArgs(program: string, args: readonly string[]): string[] {
  const name = program.split("/").at(-1) ?? program;
  const flag = ACCEPT_ALL[name];
  if (flag === undefined) throw new Error(`settings.acceptAll: program ${name} has no known flag that accepts every request`);
  return flag.same.some((one) => args.includes(one)) ? [] : [flag.add];
}

// The program and arguments that start the cli with args: through env with the variable of the home of the account, so the member uses its
// login, and the variables of the launch of a maker definition sorted by name; the cli itself when there is no variable (agents
// docs/spec/definitions.md#resolution).
function homeLaunch(definition: AgentDefinition, args: string[]): { program: string; args: string[] } {
  const env = definition.launch?.env ?? {};
  const variables = [
    ...(definition.home === null ? [] : [`${definition.home.variable}=${definition.home.folder}`]),
    ...Object.keys(env).sort().map((name) => `${name}=${env[name]}`),
  ];
  if (variables.length === 0) return { program: definition.program, args };
  return { program: "env", args: [...variables, definition.program, ...args] };
}

// The member of the room for a definition: the session opens with the terminal's start values of the definition (program, arguments,
// the directory of the definition and its role), and the plugin that runs the session is the one of the definition. A Claude Code member
// whose definition has an agent file starts with `--agent <agent>`, so it runs with the instructions and tools of that agent (C101).
export function toMemberDefinition(definition: AgentDefinition, agent: string | null = null, acceptAll = false): MemberDefinition {
  // The arguments of the launch of a maker definition follow those of the account (agents docs/spec/definitions.md#resolution).
  const launched = memberLaunch(definition.program, [...definition.args, ...(definition.launch?.args ?? [])]).args;
  const args = acceptAll ? [...launched, ...acceptAllArgs(definition.program, launched)] : launched;
  return {
    id: definition.id,
    name: definition.name,
    plugin: definition.plugin,
    params: { ...homeLaunch(definition, agent === null ? args : [...args, "--agent", agent]), directory: definition.cwd, role: definition.role },
    cwd: definition.cwd,
  };
}
