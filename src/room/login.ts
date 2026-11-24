// The login of the account home of a member (C130, docs/spec/room.md#login). An agent CLI in a home without a login shows its first
// start and answers no line of the room, so the room reads the login of each home with the status command of the CLI before it starts a
// member, and opens the login of the account as the agents plugin opens it (agents docs/spec/definitions.md#account-homes).
import type { AgentDefinition } from "./definitions";

// The declared status program and the login arguments of each CLI, by the last path segment of its program: claude auth status --json
// prints {loggedIn, configDirectory, loginExpiresAt}, and codex login status exits 0 or 1 (agents docs/spec/definitions.md#account-homes).
const CLIS: Record<string, { program: string; status: string[]; login: string[] }> = {
  claude: { program: "claude-status", status: ["auth", "status", "--json"], login: [] },
  codex: { program: "codex-status", status: ["login", "status"], login: ["login"] },
};

function cliOf(definition: AgentDefinition): { program: string; status: string[]; login: string[] } {
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

// The params of the owned session that opens the login of the account of the member in its home and in the working folder of the
// member: the first start of claude asks the text style, the login and the trust of that folder, which the person answers once.
export function loginSession(definition: AgentDefinition): { program: string; args: string[]; directory: string; title: string } {
  if (definition.home === null) throw new Error(`member ${definition.id} needs no login`);
  return {
    program: "env",
    args: [`${definition.home.variable}=${definition.home.folder}`, definition.program, ...cliOf(definition).login],
    directory: definition.cwd,
    title: `${definition.account} 로그인`,
  };
}

export interface LoginGateDeps {
  // The definitions of the room, whose login sessions the gate adopts after a restart.
  definitions: () => readonly AgentDefinition[];
  // Runs the declared status program with the arguments and gives its reply.
  run: (program: string, args: string[]) => Promise<ProgramReply>;
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
  // Takes the open sessions of the room from core.sessions with their showing tab, ends a listed login session whose tab closed, and
  // gives whether a login session that core.sessions listed has ended.
  sessionsChanged(open: readonly { session: string; shownBy: string | null; params: unknown }[]): Promise<boolean>;
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
    async sessionsChanged(open) {
      // An owned session whose params open the login of the account of a definition is a login session of the room, also one that a
      // page before a restart opened (docs/spec/room.md#login).
      const logins = deps.definitions().flatMap((definition) => (definition.home === null ? [] : [JSON.stringify(loginSession(definition))]));
      for (const entry of open) if (!sessions.has(entry.session) && logins.includes(JSON.stringify(entry.params))) sessions.set(entry.session, true);
      let ended = false;
      for (const [session, listed] of [...sessions]) {
        const entry = open.find((one) => one.session === session);
        if (entry !== undefined) {
          sessions.set(session, true);
          // An owned session stays open when its tab closes; the CLI of a claude login stays at its prompt after the login, so the
          // room ends the login session when the person closes its tab.
          if (listed && entry.shownBy === null) await deps.commands.execute("core.session.end", { session });
        } else if (listed) {
          sessions.delete(session);
          ended = true;
        }
      }
      return ended;
    },

  };
}
