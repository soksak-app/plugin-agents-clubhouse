// The login of the account home of a member (C130, docs/spec/room.md#login). An agent CLI in a home without a login shows its first
// start and answers no line of the room, so the room reads the login of each home with the status command of the CLI before it starts a
// member, and opens the login of the account as the agents plugin opens it (agents docs/spec/definitions.md#account-homes).
import type { AgentDefinition } from "./definitions";

// The status command and the login arguments of each CLI, by the last path segment of its program.
const CLIS: Record<string, { status: string[]; login: string[] }> = {
  claude: { status: ["auth", "status"], login: [] },
  codex: { status: ["login", "status"], login: ["login"] },
};

function cliOf(definition: AgentDefinition): { status: string[]; login: string[] } {
  const name = definition.program.split("/").at(-1) ?? "";
  const cli = CLIS[name];
  if (cli === undefined) throw new Error(`member ${definition.id}: the cli ${name} has no login status command`);
  return cli;
}

// The arguments of the declared program account-login (/usr/bin/env) for the home of the member, or null for an account without a home.
export function loginCheckArgs(definition: AgentDefinition): string[] | null {
  if (definition.home === null) return null;
  return [`${definition.home.variable}=${definition.home.folder}`, definition.program, ...cliOf(definition).status];
}

// Exit status 0 of the status command is a login and 1 is none; another status is an error of the member.
export function loginOf(member: string, code: number): boolean {
  if (code === 0) return true;
  if (code === 1) return false;
  throw new Error(`member ${member}: the program account-login ended with status ${code}`);
}

// The members whose home has no login. Each home is read once, in the order of the definitions.
export async function membersWithoutLogin(
  definitions: readonly AgentDefinition[],
  run: (args: string[]) => Promise<{ code: number }>,
): Promise<Set<string>> {
  const logins = new Map<string, boolean>();
  const without = new Set<string>();
  for (const definition of definitions) {
    const args = loginCheckArgs(definition);
    if (args === null) continue;
    const folder = definition.home!.folder;
    if (!logins.has(folder)) logins.set(folder, loginOf(definition.id, (await run(args)).code));
    if (!logins.get(folder)) without.add(definition.id);
  }
  return without;
}

// The params of the owned session that opens the login of the account of the member in its home.
export function loginSession(definition: AgentDefinition): { program: string; args: string[]; title: string } {
  if (definition.home === null) throw new Error(`member ${definition.id} needs no login`);
  return {
    program: "env",
    args: [`${definition.home.variable}=${definition.home.folder}`, definition.program, ...cliOf(definition).login],
    title: `${definition.account} 로그인`,
  };
}

export interface LoginGateDeps {
  // Runs the declared program account-login with the arguments and gives its exit status.
  run: (args: string[]) => Promise<{ code: number }>;
  commands: { execute: (name: string, params: Record<string, unknown>) => Promise<unknown> };
  // The size of an opened session, the measured card size of the room.
  size: () => Promise<{ width: number; height: number; scale: number }>;
}

// The members that wait for the login of their home and the login sessions that the room opened (docs/spec/room.md#login).
export interface LoginGate {
  // Reads the login of the homes of the members that would start, and gives the identifiers of those that start, in their order.
  startable(definitions: readonly AgentDefinition[]): Promise<string[]>;
  needs(id: string): boolean;
  // member.login: opens the login of the account of the member as an owned session shown in a tab of the current card.
  open(definition: AgentDefinition): Promise<{ id: string; session: string }>;
  // Takes the open sessions of the room from core.sessions, and gives whether a login session that it listed has ended.
  sessionsChanged(open: ReadonlySet<string>): boolean;
}

export function createLoginGate(deps: LoginGateDeps): LoginGate {
  let needed = new Set<string>();
  // Each login session with whether core.sessions has listed it.
  const sessions = new Map<string, boolean>();
  return {
    async startable(definitions) {
      needed = await membersWithoutLogin(definitions, deps.run);
      return definitions.map((definition) => definition.id).filter((id) => !needed.has(id));
    },
    needs: (id) => needed.has(id),
    async open(definition) {
      const login = loginSession(definition);
      if (!needed.has(definition.id)) throw new Error(`member ${definition.id} needs no login`);
      const reply = await deps.commands.execute("core.session.open", { plugin: definition.plugin, params: login, size: await deps.size() });
      const session = (reply as { session?: unknown } | null | undefined)?.session;
      if (typeof session !== "string" || session === "") throw new Error("core.session.open reply has no session");
      sessions.set(session, false);
      await deps.commands.execute("core.layout.open", { card: "current", plugin: definition.plugin, params: { session, title: login.title } });
      return { id: definition.id, session };
    },
    sessionsChanged(open) {
      let ended = false;
      for (const [session, listed] of [...sessions]) {
        if (open.has(session)) sessions.set(session, true);
        else if (listed) {
          sessions.delete(session);
          ended = true;
        }
      }
      return ended;
    },
  };
}
