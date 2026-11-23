// The team commands of the page (docs/spec/room.md#team): member.release ends the session of a team member and lets the arrangement
// close its tab, member.merged records the merge commit that the leader names, conversation.stop releases the whole team, and the team
// view lists the team. The room reads no git state and judges no work.
import type { AnswerChannel } from "./answer";
import { mergedCommit, releasedEntry, releaseTeam, retaskedEntry, teamName, teamView, type TeamEntry, type TeamViewEntry } from "./team";

export interface TeamControlDeps {
  team: TeamEntry[];
  definitions: () => readonly { id: string; name: string }[];
  // The session of a member, null without an open relation.
  sessionOf: (id: string) => string | null;
  // The leader of the room, undefined without one.
  leader: () => { id: string } | undefined;
  answers: Pick<AnswerChannel, "tokens">;
  // Ends a session through core.session.end.
  end: (session: string) => Promise<void>;
  // Appends a line of the room to the record.
  append: (text: string) => void;
  // Runs the summon and the arrangement, which close the tabs of ended sessions.
  summon: () => void;
  // Writes the tab state and publishes the conversation status.
  changed: () => void;
  report: (where: string, text: string) => void;
  // The agent name of a definition, null when its role lists no agent file.
  agentOf: (definition: string) => Promise<string | null>;
  // Whether the member is in a turn: the room waits for its protocol turn or for its answer.
  busy: (member: string) => boolean;
  // Runs after a retask ended the session of the member, with that session or null, so the page moves its delivery to the resumed session.
  retasked: (member: string, session: string | null) => void;
  // Resolves when core.sessions no longer lists the session: core.session.end answers before core.sessions drops it, and a summon
  // before that sees the ended session open and opens nothing.
  gone: (session: string) => Promise<void>;
  // The state of core.tab.role of the tab of the member, null without a role change.
  roleState: (member: string) => "pending" | "ready" | null;
}

export interface TeamControl {
  release(params: unknown): Promise<{ member: string }>;
  merged(params: unknown): Promise<{ member: string; commit: string }>;
  retask(params: unknown): Promise<{ member: string; definition: string; role: string }>;
  // Starts the release of the whole team and returns the number of team members that it ends.
  releaseAll(): number;
  // Resolves when the last release of the whole team has ended.
  released(): Promise<void>;
  view(sessions: unknown): TeamViewEntry[];
}

export function createTeamControl(deps: TeamControlDeps): TeamControl {
  const leaderTurns = () => {
    const leader = deps.leader();
    if (leader === undefined) return null;
    return { id: leader.id, turns: deps.answers.tokens().filter((token) => token.member === leader.id).map((token) => token.turn) };
  };
  let lastRelease: Promise<void> = Promise.resolve();
  return {
    async release(params) {
      const entry = releasedEntry(params, deps.team, leaderTurns());
      const session = deps.sessionOf(entry.id);
      if (session !== null) await deps.end(session);
      deps.team.splice(deps.team.indexOf(entry), 1);
      deps.append(`@${teamName(entry, deps.definitions())} was released`);
      deps.changed();
      deps.summon();
      return { member: entry.id };
    },
    // member.retask ends the session, gives the entry the new definition and agent, and the summon resumes the session id with it
    // (docs/spec/room.md#team). Every refusal comes before the session ends.
    async retask(params) {
      const { entry, definition, role } = retaskedEntry(params, deps.team, deps.definitions(), leaderTurns(), deps.busy);
      const agent = await deps.agentOf(definition);
      if (agent === null) throw new Error(`definition ${definition} has no agent file for --agent`);
      const before = teamName(entry, deps.definitions());
      const session = deps.sessionOf(entry.id);
      if (session !== null) {
        await deps.end(session);
        await deps.gone(session);
      }
      entry.definition = definition;
      entry.role = role;
      entry.agent = agent;
      entry.resume = true;
      deps.append(`@${before} is now ${definition}, named @${teamName(entry, deps.definitions())}`);
      deps.retasked(entry.id, session);
      deps.changed();
      deps.summon();
      return { member: entry.id, definition, role };
    },
    async merged(params) {
      const { entry, commit } = mergedCommit(params, deps.team, leaderTurns());
      entry.merged = commit;
      deps.changed();
      return { member: entry.id, commit };
    },
    releaseAll() {
      const count = deps.team.length;
      if (count === 0) return 0;
      lastRelease = releaseTeam(deps.team, deps.sessionOf, deps.end, deps.append)
        .then(() => {
          deps.changed();
          deps.summon();
        })
        .catch((error: unknown) => deps.report("room team", error instanceof Error ? error.message : String(error)));
      return count;
    },
    released: () => lastRelease,
    view: (sessions) => teamView(deps.team, deps.definitions(), deps.sessionOf, sessions, deps.roleState),
  };
}
