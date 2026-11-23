// The team of the leader (docs/spec/room.md#team). The leader summons each member with member.summon; the command checks only its
// input, because the leader owns the work and the folders, and the terminal refuses a directory that does not exist. A team member
// has the summon id `<definition>-<n>`, `<n>` being the smallest positive integer that no team member of the definition uses.

export interface TeamEntry {
  id: string;
  definition: string;
  role: string;
  directory: string;
  // The merge commit that the leader recorded with member.merged, null before it; the room reads no git state.
  merged: string | null;
  // The Claude Code session id that the member starts with and that a retask resumes, null for another program.
  agentSession: string | null;
  // Whether the next launch resumes agentSession: true after the first launch.
  resume: boolean;
  // The agent name of --agent, the frontmatter name of the agent file of the role of the definition, or null.
  agent: string | null;
  // The worktree of the member that the room created at the summon outside the repository, on the branch of its id, null before it
  // (docs/spec/room.md#worktrees).
  worktree: string | null;
}

export interface SummonCheck {
  team: readonly TeamEntry[];
  definitions: readonly { id: string; name: string }[];
  // The leader and the tokens of its open turns; null without a leader.
  leader: { id: string; turns: string[] } | null;
  maxMembers: number;
}

const MAX_MEMBERS = 16;

// Reads the plugin setting maxMembers, an integer from 1 to 16, and refuses any other value.
export function maxMembersOf(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_MEMBERS) {
    throw new Error(`settings.maxMembers must be an integer from 1 to ${MAX_MEMBERS}, got ${JSON.stringify(value)}`);
  }
  return value as number;
}

// The role text of the roles rule (docs/spec/room.md#roles).
export function roleOf(role: unknown): string {
  if (typeof role !== "string" || [...role].length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(role)) {
    throw new Error(`role must be a text of 0 to 200 characters without control characters, got ${JSON.stringify(role)}`);
  }
  return role.trim();
}

// The team entry of a summon, or the refusal of its input.
export function summonedEntry(params: any, check: SummonCheck): TeamEntry {
  leaderTurn("member.summon", params, check.leader);
  const definition = params?.definition;
  if (typeof definition !== "string" || !check.definitions.some((entry) => entry.id === definition)) {
    throw new Error(`definition ${typeof definition === "string" ? definition : JSON.stringify(definition)} is not an agent definition`);
  }
  const role = roleOf(params?.role);
  const directory = params?.directory;
  if (typeof directory !== "string" || !directory.startsWith("/") || /[\u0000-\u001f]/.test(directory)) {
    throw new Error(`directory must be an absolute path, got ${JSON.stringify(directory)}`);
  }
  if (check.team.length >= check.maxMembers) throw new Error(`the team has reached maxMembers ${check.maxMembers}`);
  const used = new Set(check.team.filter((entry) => entry.definition === definition).map((entry) => entry.id));
  let n = 1;
  while (used.has(`${definition}-${n}`)) n += 1;
  return { id: `${definition}-${n}`, definition, role, directory, merged: null, agentSession: null, resume: false, agent: null, worktree: null };
}

// The Claude Code arguments of a launch of the team member (docs/spec/room.md#team): the first launch names the session id, a later
// launch resumes it, because Claude Code refuses a second --session-id with the same id; the agent follows.
export function agentArgs(entry: TeamEntry): string[] {
  if (entry.agentSession === null) return [];
  return [entry.resume ? "--resume" : "--session-id", entry.agentSession, ...(entry.agent === null ? [] : ["--agent", entry.agent])];
}

// The name of a team member: the name of its definition and its number, by which a mention names it.
export function teamName(entry: TeamEntry, definitions: readonly { id: string; name: string }[]): string {
  const name = definitions.find((definition) => definition.id === entry.definition)?.name ?? entry.definition;
  // The number of the summon id stays when a retask changes the definition.
  return `${name}${entry.id.slice(entry.id.lastIndexOf("-"))}`;
}

type Leader = SummonCheck["leader"];

// Refuses a command of the leader without the token of an open turn of the leader.
function leaderTurn(command: string, params: any, leader: Leader): void {
  if (leader === null) throw new Error(`${command} needs a leader: set one with member.leader`);
  const turn = params?.turn;
  if (typeof turn !== "string" || !leader.turns.includes(turn)) {
    throw new Error(`${command} takes the turn token of the leader ${leader.id}, got ${typeof turn === "string" ? turn : JSON.stringify(turn)}`);
  }
}

function teamMember(params: any, team: readonly TeamEntry[]): TeamEntry {
  const member = params?.member;
  const entry = team.find((one) => one.id === member);
  if (entry === undefined) throw new Error(`member ${typeof member === "string" ? member : JSON.stringify(member)} is not in the team`);
  return entry;
}

// The team member that member.release ends (docs/spec/room.md#team).
export function releasedEntry(params: any, team: readonly TeamEntry[], leader: Leader): TeamEntry {
  leaderTurn("member.release", params, leader);
  return teamMember(params, team);
}

// The team member and the definition of a retask (docs/spec/room.md#team), checked in this order: the turn token of the leader, the
// member, the definition, the role text, an open turn of the member and its Claude Code session id.
export function retaskedEntry(
  params: any,
  team: readonly TeamEntry[],
  definitions: readonly { id: string }[],
  leader: Leader,
  busy: (member: string) => boolean,
): { entry: TeamEntry; definition: string; role: string } {
  leaderTurn("member.retask", params, leader);
  const entry = teamMember(params, team);
  const definition = params?.definition;
  if (typeof definition !== "string" || !definitions.some((one) => one.id === definition)) {
    throw new Error(`definition ${typeof definition === "string" ? definition : JSON.stringify(definition)} is not an agent definition`);
  }
  const role = roleOf(params?.role);
  if (busy(entry.id)) throw new Error(`member ${entry.id} is in a turn; retask it after its answer`);
  if (entry.agentSession === null) throw new Error(`member ${entry.id} has no Claude Code session to resume`);
  return { entry, definition, role };
}

// The team member and the commit that member.merged records.
export function mergedCommit(params: any, team: readonly TeamEntry[], leader: Leader): { entry: TeamEntry; commit: string } {
  leaderTurn("member.merged", params, leader);
  const entry = teamMember(params, team);
  const commit = params?.commit;
  if (typeof commit !== "string" || commit.trim() === "" || commit.length > 64 || /[\u0000-\u001f]/.test(commit)) {
    throw new Error(`commit must be a text of 1 to 64 characters, got ${JSON.stringify(commit)}`);
  }
  return { entry, commit: commit.trim() };
}

// Ends the session of every team member, empties the team and records the release once; an empty team changes nothing
// (docs/spec/room.md#commands).
export async function releaseTeam(
  team: TeamEntry[],
  sessionOf: (id: string) => string | null,
  end: (session: string) => Promise<void>,
  record: (text: string) => void,
): Promise<void> {
  if (team.length === 0) return;
  const entries = team.splice(0, team.length);
  for (const entry of entries) {
    const session = sessionOf(entry.id);
    if (session !== null) await end(session);
  }
  record("the team was released");
}

export interface TeamViewEntry {
  member: string;
  name: string;
  role: string;
  directory: string;
  branch: string;
  merged: string | null;
  session: string | null;
  state: "idle" | "working" | "blocked" | "ended" | null;
  // The state of core.tab.role of the tab of the member after a retask, null without a role change (docs/spec/room.md#team).
  roleState: "pending" | "ready" | null;
}

// The team view of the conversation status: `branch` is the member name of the worktree rule (docs/spec/room.md#team).
export function teamView(
  team: readonly TeamEntry[],
  definitions: readonly { id: string; name: string }[],
  sessionOf: (id: string) => string | null,
  sessions: unknown,
  roleState: (member: string) => "pending" | "ready" | null = () => null,
): TeamViewEntry[] {
  const listed = Array.isArray(sessions) ? (sessions as { session?: unknown; program?: { state?: unknown } | null }[]) : [];
  return team.map((entry) => {
    const name = teamName(entry, definitions);
    const session = sessionOf(entry.id);
    const found = listed.find((one) => one?.session === session);
    const state = session === null || found === undefined ? "ended" : ((found.program?.state as TeamViewEntry["state"]) ?? null);
    return { member: entry.id, name, role: entry.role, directory: entry.worktree ?? entry.directory, branch: entry.id, merged: entry.merged, session, state, roleState: roleState(entry.id) };
  });
}

// The row of the team view: name, role, directory, branch, merge, session state and, after a retask, the state of core.tab.role.
export function teamRowText(entry: TeamViewEntry): string {
  return [entry.name, entry.role, entry.directory, entry.branch, entry.merged === null ? "not merged" : `merged ${entry.merged}`, String(entry.state), entry.roleState === null ? "" : `role ${entry.roleState}`]
    .filter((part) => part !== "")
    .join(" · ");
}

// The role state of the reply of core.tab.role {tab, role} (core docs/spec/agent-roles.md#tab-role-state). The room shows this state and
// watches no core.tab.role, because core refuses a status watch of a surface that is not of the plugin of the view.
export function roleReplyState(reply: unknown): "pending" | "ready" {
  const state = (reply as { state?: unknown } | null)?.state;
  if (state !== "pending" && state !== "ready") throw new Error(`core.tab.role reply state must be pending or ready, got ${JSON.stringify(state)}`);
  return state;
}
