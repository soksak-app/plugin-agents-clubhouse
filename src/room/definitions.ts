// The agent definitions of the room, read from the stored project data of the agents plugin (agents docs/spec/definitions.md): the key
// definitions holds each definition with {name, account, plugin, role, cwd}, and the key accounts holds each account with {id, cli, args,
// env}. Program and args are not stored: they are the cli and args of the account of the definition, resolved here with the rule of the
// agents plugin. The room names no plugin in its code; plugin comes from each definition. A stored value of another form is refused with
// an explicit error that names the agents project data and the key.
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
export async function readAgentDefinitions(get: AgentDataGet): Promise<AgentDefinition[]> {
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
    if (!isRecord(record) || !sameMembers(record, DEFINITION_MEMBERS) || !DEFINITION_MEMBERS.every((key) => typeof record[key] === "string")) {
      throw new Error(`${WHERE} definitions: definition ${id} must have the members account, cwd, name, plugin and role`);
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
  return definitions;
}

// The member of the room for a definition: the session opens with the terminal's start values of the definition (program, arguments,
// the directory of the definition and its role), and the plugin that runs the session is the one of the definition.
export function toMemberDefinition(definition: AgentDefinition): MemberDefinition {
  return {
    id: definition.id,
    name: definition.name,
    plugin: definition.plugin,
    params: { program: definition.program, args: [...definition.args], directory: definition.cwd, role: definition.role },
    cwd: definition.cwd,
  };
}
