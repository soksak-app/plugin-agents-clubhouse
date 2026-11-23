// The team commands of the page (C90-1, docs/spec/room.md#team): member.release, member.merged, the release of the team by
// conversation.stop and the team view, over the room record, the answer channel and a core double that ends sessions.
import { describe, expect, it } from "vitest";
import { createTeamControl } from "./team-control";
import { createRoomRecord } from "./room-record";
import { createAnswerChannel } from "./answer";
import type { TeamEntry } from "./team";

const DEFINITIONS = [{ id: "claude", name: "Claude" }];

function page() {
  const team: TeamEntry[] = [
    { id: "claude-1", definition: "claude", role: "server", directory: "/work/game", merged: null, agentSession: null, resume: false, agent: null },
    { id: "claude-2", definition: "claude", role: "client", directory: "/work/game", merged: null, agentSession: null, resume: false, agent: null },
  ];
  const sessions = new Map([["claude-1", "s-1"], ["claude-2", "s-2"], ["lead", "s-l"]]);
  let core = [{ session: "s-1", program: { state: "idle" } }, { session: "s-2", program: { state: "working" } }, { session: "s-l", program: { state: "working" } }];
  const ended: string[] = [];
  const log: string[] = [];
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
  });
  return { team, ended, log, record, control, core: () => core };
}

describe("the team commands of the page", () => {
  it("member.release ends the session, removes the member, records the release and rearranges the tabs", async () => {
    const p = page();
    expect(p.control.view(p.core()).map((entry) => [entry.member, entry.state])).toEqual([["claude-1", "idle"], ["claude-2", "working"]]);
    expect(await p.control.release({ turn: "t-1", member: "claude-1" })).toEqual({ member: "claude-1" });
    expect(p.ended).toEqual(["s-1"]);
    expect(p.team.map((entry) => entry.id)).toEqual(["claude-2"]);
    expect(p.record.lines.at(-1)).toMatchObject({ speaker: "clubhouse", text: "@Claude-1 was released" });
    expect(p.log).toEqual(["changed", "summon"]);
    await expect(p.control.release({ turn: "t-9", member: "claude-2" })).rejects.toThrow("member.release takes the turn token of the leader lead, got t-9");
  });

  it("member.merged shows the commit in the team view", async () => {
    const p = page();
    expect(await p.control.merged({ turn: "t-1", member: "claude-2", commit: "abc1234" })).toEqual({ member: "claude-2", commit: "abc1234" });
    expect(p.control.view(p.core()).find((entry) => entry.member === "claude-2")).toMatchObject({ merged: "abc1234", branch: "Claude-2" });
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
