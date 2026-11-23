// The team commands of the page (C90-1, docs/spec/room.md#team): member.release, member.merged, the release of the team by
// conversation.stop and the team view, over the room record, the answer channel and a core double that ends sessions.
import { describe, expect, it } from "vitest";
import { createTeamControl } from "./team-control";
import { createRoomRecord } from "./room-record";
import { createAnswerChannel } from "./answer";
import type { TeamEntry } from "./team";

const DEFINITIONS = [{ id: "claude", name: "Claude" }, { id: "tester", name: "Tester" }, { id: "bare", name: "Bare" }];

function page() {
  const team: TeamEntry[] = [
    { id: "claude-1", definition: "claude", role: "server", directory: "/work/game", merged: null, agentSession: "u-1", resume: true, agent: "developer", worktree: null },
    { id: "claude-2", definition: "claude", role: "client", directory: "/work/game", merged: null, agentSession: null, resume: false, agent: null, worktree: null },
  ];
  const sessions = new Map([["claude-1", "s-1"], ["claude-2", "s-2"], ["lead", "s-l"]]);
  let core = [{ session: "s-1", program: { state: "idle" } }, { session: "s-2", program: { state: "working" } }, { session: "s-l", program: { state: "working" } }];
  const ended: string[] = [];
  const removed: string[] = [];
  const log: string[] = [];
  const gones: (() => void)[] = [];
  const record = createRoomRecord([], {}, (speaker) => speaker, () => {});
  let next = 0;
  const answers = createAnswerChannel({ newTurn: () => `t-${++next}`, delivered: () => {}, restoredAnswer: () => {}, changed: () => {} });
  answers.open("s-l", "lead", 0);
  const control = createTeamControl({
    team,
    definitions: () => DEFINITIONS,
    sessionOf: (id) => sessions.get(id) ?? null,
    leader: () => ({ id: "lead" }),
    answers,
    end: async (session) => {
      ended.push(session);
      core = core.filter((entry) => entry.session !== session);
    },
    append: (text) => record.append("clubhouse", text),
    summon: () => void log.push("summon"),
    changed: () => void log.push("changed"),
    report: (where, text) => void log.push(`${where}: ${text}`),
    removeWorktree: async (entry) => {
      if (entry.worktree === "/w/dirty") throw new Error("fatal: '/w/dirty' contains modified or untracked files");
      removed.push(entry.worktree!);
    },
    agentOf: async (definition) => ({ claude: "developer", tester: "e2e-tester" } as Record<string, string>)[definition] ?? null,
    busy: (member) => member === "claude-2",
    retasked: (member, session) => void log.push(`retasked ${member} ${session}`),
    gone: (session) => new Promise<void>((resolve) => void gones.push(() => { log.push(`gone ${session}`); resolve(); })),
    roleState: (member) => (member === "claude-1" ? "pending" : null),
  });
  return { team, ended, removed, log, record, control, core: () => core, gones };
}

describe("the team commands of the page", () => {
  it("member.release ends the session, removes the member, records the release and rearranges the tabs", async () => {
    const p = page();
    expect(p.control.view(p.core()).map((entry) => [entry.member, entry.state])).toEqual([["claude-1", "idle"], ["claude-2", "working"]]);
    const released = p.control.release({ turn: "t-1", member: "claude-1" });
    await Promise.resolve();
    p.gones.shift()!();
    expect(await released).toEqual({ member: "claude-1" });
    expect(p.ended).toEqual(["s-1"]);
    expect(p.team.map((entry) => entry.id)).toEqual(["claude-2"]);
    expect(p.record.lines.at(-1)).toMatchObject({ speaker: "clubhouse", text: "@Claude-1 was released" });
    expect(p.log).toEqual(["gone s-1", "changed", "summon"]);
    await expect(p.control.release({ turn: "t-9", member: "claude-2" })).rejects.toThrow("member.release takes the turn token of the leader lead, got t-9");
  });

  it("member.release removes the worktree of the member after its session is gone, and names a worktree that git keeps", async () => {
    const p = page();
    p.team[0]!.worktree = "/w/claude-1";
    p.team[1]!.worktree = "/w/dirty";
    const first = p.control.release({ turn: "t-1", member: "claude-1" });
    await Promise.resolve();
    expect(p.removed).toEqual([]);
    p.gones.shift()!();
    await first;
    expect(p.removed).toEqual(["/w/claude-1"]);
    const second = p.control.release({ turn: "t-1", member: "claude-2" });
    await Promise.resolve();
    p.gones.shift()!();
    await second;
    expect(p.record.lines.at(-1)!.text).toBe("the worktree /w/dirty of @Claude-2 stays: fatal: '/w/dirty' contains modified or untracked files");
    expect(p.log.at(-3)).toBe("room worktree: member claude-2: fatal: '/w/dirty' contains modified or untracked files");
  });

  it("member.merged shows the commit in the team view", async () => {
    const p = page();
    expect(await p.control.merged({ turn: "t-1", member: "claude-2", commit: "abc1234" })).toEqual({ member: "claude-2", commit: "abc1234" });
    expect(p.control.view(p.core()).find((entry) => entry.member === "claude-2")).toMatchObject({ merged: "abc1234", branch: "claude-2" });
  });

  it("the stop releases every team session once and the team view empties", async () => {
    const p = page();
    expect(p.control.releaseAll()).toBe(2);
    await p.control.released();
    expect(p.ended).toEqual(["s-1", "s-2"]);
    expect(p.control.view(p.core())).toEqual([]);
    expect(p.record.lines.map((line) => line.text)).toEqual(["the team was released"]);
    expect(p.control.releaseAll()).toBe(0);
  });
});

// C97-2 (docs/spec/room.md#team): member.retask gives a team member another definition and keeps its conversation.
describe("member.retask", () => {
  it("ends the session, sets the definition and the agent, resumes the session id, records the change and rearranges", async () => {
    const p = page();
    const retask = p.control.retask({ turn: "t-1", member: "claude-1", definition: "tester", role: "e2e checks" });
    // C97-4: core.session.end answers before core.sessions drops the session, so the summon waits for core.sessions to drop it.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(p.log).not.toContain("summon");
    p.gones.forEach((done) => done());
    expect(await retask).toEqual({ member: "claude-1", definition: "tester", role: "e2e checks" });
    expect(p.ended).toEqual(["s-1"]);
    expect(p.team[0]).toMatchObject({ id: "claude-1", definition: "tester", role: "e2e checks", agentSession: "u-1", resume: true, agent: "e2e-tester", worktree: null });
    expect(p.record.lines.at(-1)).toMatchObject({ speaker: "clubhouse", text: "@Claude-1 is now tester, named @Tester-1" });
    expect(p.log).toEqual(["gone s-1", "retasked claude-1 s-1", "changed", "summon"]);
    expect(p.control.view(p.core()).find((entry) => entry.member === "claude-1")).toMatchObject({ name: "Tester-1", roleState: "pending" });
  });

  it("refuses a caller without the leader token, an unknown member or definition, a member in a turn, and a definition without an agent file", async () => {
    const p = page();
    await expect(p.control.retask({ turn: "t-9", member: "claude-1", definition: "tester", role: "e2e checks" })).rejects.toThrow("member.retask takes the turn token of the leader lead, got t-9");
    await expect(p.control.retask({ turn: "t-1", member: "gone", definition: "tester", role: "e2e checks" })).rejects.toThrow("member gone is not in the team");
    await expect(p.control.retask({ turn: "t-1", member: "claude-1", definition: "nope", role: "x" })).rejects.toThrow("definition nope is not an agent definition");
    await expect(p.control.retask({ turn: "t-1", member: "claude-2", definition: "tester", role: "e2e checks" })).rejects.toThrow("member claude-2 is in a turn; retask it after its answer");
    await expect(p.control.retask({ turn: "t-1", member: "claude-1", definition: "bare", role: "x" })).rejects.toThrow("definition bare has no agent file for --agent");
    await expect(p.control.retask({ turn: "t-1", member: "claude-1", definition: "tester", role: "a\nb" })).rejects.toThrow("role must be a text of 0 to 200 characters without control characters");
    await expect(p.control.retask({ turn: "t-1", member: "claude-1", definition: "tester" })).rejects.toThrow("role must be a text of 0 to 200 characters without control characters, got undefined");
    p.team[0].agentSession = null;
    await expect(p.control.retask({ turn: "t-1", member: "claude-1", definition: "tester", role: "e2e checks" })).rejects.toThrow("member claude-1 has no Claude Code session to resume");
    expect(p.ended).toEqual([]);
    expect(p.team[0]).toMatchObject({ definition: "claude", role: "server" });
  });
});
