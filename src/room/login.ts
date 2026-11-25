// The login of the account home of a member (C130, docs/spec/room.md#login). An agent CLI in a home without a login shows its first
// start and answers no line of the room, so the room reads the login of each home with the status command of the CLI before it starts a
// member. The room opens no login: the agents plugin logs in to an account, and a member uses the login of its account
// (agents docs/spec/definitions.md#account-homes).
import type { AgentDefinition } from "./definitions";

// The declared status program and the status arguments of each CLI, by the last path segment of its program: claude auth status --json
// prints {loggedIn, configDirectory, loginExpiresAt}, and codex login status exits 0 or 1 (agents docs/spec/definitions.md#account-homes).
const CLIS: Record<string, { program: string; status: string[] }> = {
  claude: { program: "claude-status", status: ["auth", "status", "--json"] },
  codex: { program: "codex-status", status: ["login", "status"] },
};

function cliOf(definition: AgentDefinition): { program: string; status: string[] } {
  const name = definition.program.split("/").at(-1) ?? "";
  const cli = CLIS[name];
  if (cli === undefined) throw new Error(`member ${definition.id}: the cli ${name} has no login status command`);
  return cli;
}

// The reply of a declared program that the room reads.
export interface ProgramReply {
  code: number;
  stdout: string;
  stderr: string;
  truncated: { stdout: boolean; stderr: boolean };
}

// The declared status program and its arguments for the home of the member, or null for an account without a home.
export function loginCheck(definition: AgentDefinition): { program: string; args: string[] } | null {
  if (definition.home === null) return null;
  const cli = cliOf(definition);
  return { program: cli.program, args: [`${definition.home.variable}=${definition.home.folder}`, definition.program, ...cli.status] };
}

// The login of the home of the member from the reply of its status program. claude exits 0 with loggedIn true and 1 with loggedIn false
// and names its configuration folder, which must be the home, because the CLI otherwise reads another login; codex exits 0 or 1.
export function loginOf(definition: AgentDefinition, reply: ProgramReply): boolean {
  const cli = cliOf(definition);
  const where = `member ${definition.id}: ${cli.program}`;
  if (reply.truncated.stdout || reply.truncated.stderr) throw new Error(`${where} output was truncated`);
  if (reply.code !== 0 && reply.code !== 1) throw new Error(`${where} ended with status ${reply.code}: ${reply.stderr.trim()}`);
  if (cli.program === "codex-status") return reply.code === 0;
  let status: unknown;
  try {
    status = JSON.parse(reply.stdout);
  } catch {
    throw new Error(`${where} printed no status JSON: ${JSON.stringify(reply.stdout.slice(0, 200))}`);
  }
  const fields = status as { loggedIn?: unknown; configDirectory?: unknown } | null;
  if (fields === null || typeof fields !== "object" || typeof fields.loggedIn !== "boolean" || typeof fields.configDirectory !== "string") {
    throw new Error(`${where} printed no status JSON: ${JSON.stringify(reply.stdout.slice(0, 200))}`);
  }
  if (fields.loggedIn !== (reply.code === 0)) throw new Error(`${where} ended with status ${reply.code} and loggedIn ${fields.loggedIn}`);
  if (fields.configDirectory !== definition.home!.folder) {
    throw new Error(`member ${definition.id}: claude reports the configuration folder ${fields.configDirectory}, not the home ${definition.home!.folder}`);
  }
  return fields.loggedIn;
}

// The members whose home has no login. Each home is read once, in the order of the definitions.
export async function membersWithoutLogin(
  definitions: readonly AgentDefinition[],
  run: (program: string, args: string[]) => Promise<ProgramReply>,
): Promise<Set<string>> {
  const logins = new Map<string, boolean>();
  const without = new Set<string>();
  for (const definition of definitions) {
    const check = loginCheck(definition);
    if (check === null) continue;
    const folder = definition.home!.folder;
    if (!logins.has(folder)) logins.set(folder, loginOf(definition, await run(check.program, check.args)));
    if (!logins.get(folder)) without.add(definition.id);
  }
  return without;
}

export interface LoginGateDeps {
  // Runs the declared status program with the arguments and gives its reply.
  run: (program: string, args: string[]) => Promise<ProgramReply>;
}

// The members that wait for the login of their home (docs/spec/room.md#login).
export interface LoginGate {
  // Reads the login of the homes of the members that would start, and gives the identifiers of those that start, in their order.
  startable(definitions: readonly AgentDefinition[]): Promise<string[]>;
  needs(id: string): boolean;
}

export function createLoginGate(deps: LoginGateDeps): LoginGate {
  let needed = new Set<string>();
  return {
    async startable(definitions) {
      needed = await membersWithoutLogin(definitions, deps.run);
      return definitions.map((definition) => definition.id).filter((id) => !needed.has(id));
    },
    needs: (id) => needed.has(id),
  };
}
