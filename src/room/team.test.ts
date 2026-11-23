// The team of the leader (docs/spec/room.md#team): member.summon checks only its input, names each summoned member by its definition
// and the smallest free number, and refuses a summon beyond the setting maxMembers.
import { describe, expect, it } from "vitest";
import { agentArgs, roleReplyState, teamRowText, maxMembersOf, mergedCommit, releasedEntry, releaseTeam, summonedEntry, teamName, teamView, type TeamEntry } from "./team";

const DEFINITIONS = [{ id: "claude", name: "Claude" }, { id: "codex", name: "Codex" }];
const LEADER = { id: "lead", turns: ["t-1"] };
const params = (over: Record<string, unknown> = {}) => ({ turn: "t-1", definition: "claude", role: "server", directory: "/work/game", ...over });

describe("summonedEntry", () => {
  it("takes the smallest free number of the definition", () => {
    const team: TeamEntry[] = [{ id: "claude-2", definition: "claude", role: "", directory: "/a", merged: null, agentSession: null, resume: false, agent: null, worktree: null }];
    expect(summonedEntry(params(), { team, definitions: DEFINITIONS, leader: LEADER, maxMembers: 6 })).toEqual({
      id: "claude-1", definition: "claude", role: "server", directory: "/work/game", merged: null, agentSession: null, resume: false, agent: null, worktree: null,
    });
    expect(teamName({ id: "claude-1", definition: "claude", role: "", directory: "/a", merged: null, agentSession: null, resume: false, agent: null, worktree: null }, DEFINITIONS)).toBe("Claude-1");
  });

  it("refuses a turn that is not an open turn of the leader, and a room without a leader", () => {
    const deps = { team: [], definitions: DEFINITIONS, leader: LEADER, maxMembers: 6 };
    expect(() => summonedEntry(params({ turn: "t-9" }), deps)).toThrow("member.summon takes the turn token of the leader lead, got t-9");
    expect(() => summonedEntry(params(), { ...deps, leader: null })).toThrow("member.summon needs a leader: set one with member.leader");
  });

  it("checks only its input: the definition, the role text and an absolute directory", () => {
    const deps = { team: [], definitions: DEFINITIONS, leader: LEADER, maxMembers: 6 };
    expect(() => summonedEntry(params({ definition: "gemini" }), deps)).toThrow("definition gemini is not an agent definition");
    expect(() => summonedEntry(params({ directory: "work/game" }), deps)).toThrow('directory must be an absolute path, got "work/game"');
    expect(() => summonedEntry(params({ role: "a\nb" }), deps)).toThrow("role must be a text of 0 to 200 characters without control characters");
  });

  it("refuses a summon beyond maxMembers", () => {
    const team: TeamEntry[] = [{ id: "claude-1", definition: "claude", role: "", directory: "/a", merged: null, agentSession: null, resume: false, agent: null, worktree: null }];
    expect(() => summonedEntry(params(), { team, definitions: DEFINITIONS, leader: LEADER, maxMembers: 1 })).toThrow("the team has reached maxMembers 1");
  });
});

describe("maxMembersOf", () => {
  it("accepts an integer from 1 to 16", () => {
    expect(maxMembersOf(6)).toBe(6);
    for (const value of [0, 17, 2.5, "6"]) expect(() => maxMembersOf(value)).toThrow(`settings.maxMembers must be an integer from 1 to 16, got ${JSON.stringify(value)}`);
  });
});

const ENTRY: TeamEntry = { id: "claude-1", definition: "claude", role: "server", directory: "/work/game", merged: null, agentSession: null, resume: false, agent: null, worktree: null };

describe("member.release and member.merged (docs/spec/room.md#team)", () => {
  const leader = { id: "lead", turns: ["t-1"] };
  it("takes the turn token of the leader and a member of the team", () => {
    expect(releasedEntry({ turn: "t-1", member: "claude-1" }, [ENTRY], leader)).toBe(ENTRY);
    expect(() => releasedEntry({ turn: "t-2", member: "claude-1" }, [ENTRY], leader)).toThrow("member.release takes the turn token of the leader lead, got t-2");
    expect(() => releasedEntry({ turn: "t-1", member: "codex-1" }, [ENTRY], leader)).toThrow("member codex-1 is not in the team");
  });
  it("records a merge commit of 1 to 64 characters", () => {
    expect(mergedCommit({ turn: "t-1", member: "claude-1", commit: "9c38d44" }, [ENTRY], leader)).toEqual({ entry: ENTRY, commit: "9c38d44" });
    expect(() => mergedCommit({ turn: "t-1", member: "claude-1", commit: "" }, [ENTRY], leader)).toThrow('commit must be a text of 1 to 64 characters, got ""');
  });
  it("ends every team session, empties the team and records the release once", async () => {
    const team = [ENTRY, { ...ENTRY, id: "claude-2" }];
    const ended: string[] = [];
    const lines: string[] = [];
    await releaseTeam(team, (id) => `s-${id}`, async (session) => void ended.push(session), (text) => void lines.push(text));
    expect(ended).toEqual(["s-claude-1", "s-claude-2"]);
    expect(team).toEqual([]);
    expect(lines).toEqual(["the team was released"]);
    await releaseTeam(team, () => null, async () => {}, (text) => void lines.push(text));
    expect(lines).toHaveLength(1);
  });
});

describe("teamView", () => {
  it("shows member, name, role, directory, branch, merge and session state", () => {
    const sessions = [{ session: "s-1", program: { state: "idle" } }];
    expect(teamView([ENTRY, { ...ENTRY, id: "claude-2", merged: "abc" }], DEFINITIONS, (id) => (id === "claude-1" ? "s-1" : "s-9"), sessions)).toEqual([
      { member: "claude-1", name: "Claude-1", role: "server", directory: "/work/game", branch: "claude-1", merged: null, session: "s-1", state: "idle", roleState: null },
      { member: "claude-2", name: "Claude-2", role: "server", directory: "/work/game", branch: "claude-2", merged: "abc", session: "s-9", state: "ended", roleState: null },
    ]);
  });
});

// C97-1 (docs/spec/room.md#team): a Claude Code team member starts with its session id and agent, and a later launch resumes the id.
describe("agentArgs", () => {
  const entry = (over: Partial<TeamEntry>): TeamEntry =>
    ({ id: "claude-1", definition: "claude", role: "", directory: "/a", merged: null, agentSession: null, resume: false, agent: null, worktree: null, ...over });
  it("starts with --session-id and --agent, and resumes after the first launch", () => {
    const id = "28e7fee6-d618-4598-b9a6-775f3053340e";
    expect(agentArgs(entry({ agentSession: id, agent: "manager-develop", worktree: null }))).toEqual(["--session-id", id, "--agent", "manager-develop"]);
    expect(agentArgs(entry({ agentSession: id, resume: true, agent: "e2e-tester", worktree: null }))).toEqual(["--resume", id, "--agent", "e2e-tester"]);
    expect(agentArgs(entry({ agentSession: id }))).toEqual(["--session-id", id]);
    expect(agentArgs(entry({}))).toEqual([]);
  });
  it("keeps the number of the name when the definition changes", () => {
    expect(teamName(entry({ id: "claude-3", definition: "codex" }), DEFINITIONS)).toBe("Codex-3");
  });
});

describe("teamRowText (C97-2)", () => {
  it("shows the role state of core.tab.role after a retask, and nothing without one", () => {
    const row = { member: "c-1", name: "Tester-1", role: "e2e", directory: "/w", branch: "Tester-1", merged: null, session: "s-1", state: "idle" as const };
    expect(teamRowText({ ...row, roleState: "pending" })).toBe("Tester-1 · e2e · /w · Tester-1 · not merged · idle · role pending");
    expect(teamRowText({ ...row, roleState: null })).toBe("Tester-1 · e2e · /w · Tester-1 · not merged · idle");
  });
});

// C97-5: the room reads the role state from the reply of core.tab.role {tab, role} (core docs/spec/agent-roles.md#tab-role-state),
// because core refuses a status watch of a surface that is not of the plugin of the view.
describe("roleReplyState", () => {
  it("reads the state of the reply, and refuses a reply of another form", () => {
    const reply = { role: "moai-e2e-tester", generation: 2, state: "pending", seq: 5, fingerprint: "0123456789abcdef", path: "/c/agents/tab-1/role.md" };
    expect(roleReplyState(reply)).toBe("pending");
    expect(roleReplyState({ ...reply, state: "ready" })).toBe("ready");
    expect(() => roleReplyState({ ...reply, state: null })).toThrow('core.tab.role reply state must be pending or ready, got null');
    expect(() => roleReplyState(null)).toThrow("core.tab.role reply state must be pending or ready, got undefined");
  });
});
