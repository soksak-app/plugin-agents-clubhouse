// The agent definitions of the room (core F1074, agents A13). The room reads the status agents.definitions of the agents plugin, which
// lists each definition as {id, name, account, plugin, program, args, role, cwd} with program and args resolved from the account. The
// room holds no plugin identifier in its code: plugin comes from each definition. A value of another form is refused with an explicit
// error that names the status, and nothing is converted.
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

const MEMBERS = ["id", "name", "account", "plugin", "program", "args", "role", "cwd"];
const WHERE = "agents.definitions status";

// Throws with the text of the rule when the value is not a list of definitions with exactly the declared members.
export function parseAgentDefinitions(value: unknown): AgentDefinition[] {
  if (!Array.isArray(value)) throw new Error(`${WHERE}: the value is not a list of definitions`);
  value.forEach((entry: unknown, index) => {
    const record = entry !== null && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, unknown>) : null;
    const keys = record === null ? [] : Object.keys(record).sort();
    const expected = [...MEMBERS].sort();
    const shaped = keys.length === expected.length && keys.every((key, i) => key === expected[i]);
    const texts = record !== null && ["id", "name", "account", "plugin", "program", "role", "cwd"].every((key) => typeof record[key] === "string");
    const argsText = record !== null && Array.isArray(record.args) && record.args.every((arg) => typeof arg === "string");
    if (!shaped || !texts || !argsText) {
      throw new Error(`${WHERE}: definition ${index} must have the members id, name, account, plugin, program, args, role and cwd`);
    }
  });
  return value as AgentDefinition[];
}

// The member of the room for a definition: the session opens with the terminal's start values of the definition (program, arguments,
// the directory of the definition and its role), and the plugin that runs the session is the one of the definition.
export function toMemberDefinition(definition: AgentDefinition): MemberDefinition {
  return {
    id: definition.id,
    plugin: definition.plugin,
    params: { program: definition.program, args: [...definition.args], directory: definition.cwd, role: definition.role },
    cwd: definition.cwd,
  };
}
