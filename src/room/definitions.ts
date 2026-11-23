// The agent definitions of the room, read from the stored project data of the agents plugin (agents docs/spec/definitions.md): the key
// definitions holds each definition with {name, account, plugin, role, cwd}, and the key accounts holds each account with {id, cli, args,
// env}. Program and args are not stored: they are the cli and args of the account of the definition, resolved here with the rule of the
// agents plugin. The room names no plugin in its code; plugin comes from each definition. A stored value of another form is refused with
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
  role: string;
  cwd: string;
}

// Reads the key of the agents plugin through get; the room passes the read of runtime.data.get with plugin agents (F1075).
export type AgentDataGet = (key: string) => Promise<unknown>;

const WHERE = "agents project data";
const DEFINITION_MEMBERS = ["account", "cwd", "name", "plugin", "role"];
// The agents plugin stores maker on a definition that the listing of a maker group stored (agents docs/spec/definitions.md).
const DEFINITION_OPTIONAL = ["maker"];
const ACCOUNT_MEMBERS = ["args", "cli", "env", "id"];

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
      throw new Error(`${WHERE} accounts: account ${index} must have the members id, cli, args and env only`);
    }
  });
  const definitions = Object.keys(stored).sort().map((id) => {
    const record = stored[id];
    const required = isRecord(record) ? Object.keys(record).filter((key) => !DEFINITION_OPTIONAL.includes(key)) : [];
    const shaped = isRecord(record) && sameMembers(Object.fromEntries(required.map((key) => [key, record[key]])), DEFINITION_MEMBERS);
    if (!shaped || !Object.values(record).every((value) => typeof value === "string")) {
      throw new Error(`${WHERE} definitions: definition ${id} must have the members account, cwd, name, plugin and role, and optionally maker`);
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

// The member of the room for a definition: the session opens with the terminal's start values of the definition (program, arguments,
// the directory of the definition and its role), and the plugin that runs the session is the one of the definition. A Claude Code member
// whose definition has an agent file starts with `--agent <agent>`, so it runs with the instructions and tools of that agent (C101).
export function toMemberDefinition(definition: AgentDefinition, agent: string | null = null, acceptAll = false): MemberDefinition {
  const launched = memberLaunch(definition.program, definition.args).args;
  const args = acceptAll ? [...launched, ...acceptAllArgs(definition.program, launched)] : launched;
  return {
    id: definition.id,
    name: definition.name,
    plugin: definition.plugin,
    params: { program: definition.program, args: agent === null ? args : [...args, "--agent", agent], directory: definition.cwd, role: definition.role },
    cwd: definition.cwd,
  };
}
