// The work reports and the path claims of the members (docs/spec/room.md#work-reports): a report, a claim and a release of an open turn are
// record lines of the member, which the other members read in their next turn lines; only an owner follow-up is injected into a working
// session (docs/spec/room.md#owner-follow-up). Overlapping claims of two members are refused with the holder, and the claims of a turn end
// with the turn. The submit queue sends the next line of a session only after core answered the previous one.
import { describe, expect, it } from "vitest";
import { createAnswerChannel } from "./answer";
import { createRoomRecord } from "./room-record";
import { createSubmitQueue } from "./submit-queue";
import { OWNER_INJECT_TEXT, createWorkReports } from "./work-reports";

type State = "idle" | "working" | "blocked";
const MEMBERS = [{ id: "a", name: "Alpha", session: "s-a" }, { id: "b", name: "Beta", session: "s-b" }, { id: "c", name: "Gamma", session: "s-c" }];
const nameOf = (speaker: string): string => MEMBERS.find((m) => m.id === speaker)?.name ?? speaker;

function room(states: Record<string, State>) {
  const submitted: { session: string; text: string }[] = [];
  let value = () => Object.entries(states).map(([session, state]) => ({ session, program: { state } }));
  const commands = {
    execute: async (name: string, params: Record<string, unknown>) => {
      submitted.push({ session: params.session as string, text: params.text as string });
      return {};
    },
  };
  const reports: string[] = [];
  const record = createRoomRecord([], {}, nameOf, () => {});
  let next = 0;
  let work: ReturnType<typeof createWorkReports> | null = null;
  const answers = createAnswerChannel({
    newTurn: () => `t-${++next}`,
    delivered: (session, count) => record.markDelivered(session, count),
    restoredAnswer: () => {},
    changed: () => {},
    closed: (token) => work?.closed(token),
  });
  const lines = createSubmitQueue({ commands });
  work = createWorkReports({ answers, lines, sessions: () => value(), report: (where, text) => void reports.push(`${where}: ${text}`) }, record, () => MEMBERS);
  const set = (session: string, state: State) => {
    states = { ...states, [session]: state };
    value = () => Object.entries(states).map(([s, st]) => ({ session: s, program: { state: st } }));
    work!.inject();
  };
  return { record, answers, work, submitted, reports, set };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("work reports", () => {
  it("refuses a report with a closed token", () => {
    const r = room({ "s-a": "working" });
    expect(() => r.work.reportCommand({ turn: "t-9", text: "x" })).toThrow("turn t-9 is not an open turn of this room");
  });
});

describe("path claims", () => {
  it("refuses an overlapping claim of another member with the holder, and accepts it after the release", () => {
    const r = room({ "s-a": "working", "s-b": "working" });
    const a = r.answers.open("s-a", "a", 0);
    const b = r.answers.open("s-b", "b", 0);
    expect(r.work.claim({ turn: a.turn, paths: ["src/server"] })).toEqual({ turn: a.turn, paths: ["src/server"] });
    expect(() => r.work.claim({ turn: b.turn, paths: ["src/server/api.ts"] })).toThrow("paths src/server/api.ts are claimed by a");
    expect(() => r.work.release({ turn: b.turn, paths: ["src/server"] })).toThrow("path src/server is not claimed by b");
    r.work.release({ turn: a.turn, paths: ["src/server"] });
    expect(r.work.claim({ turn: b.turn, paths: ["src/server/api.ts"] }).paths).toEqual(["src/server/api.ts"]);
    expect(r.record.lines.map((line) => line.text)).toEqual(["(claim) src/server", "(release) src/server", "(claim) src/server/api.ts"]);
  });

  it("releases the claims of a turn when the turn closes", () => {
    const r = room({ "s-a": "working" });
    const a = r.answers.open("s-a", "a", 0);
    r.work.claim({ turn: a.turn, paths: ["web/app.ts"] });
    r.answers.deliver({ turn: a.turn, text: "done", status: "settled" });
    expect(r.work.claims()).toEqual([]);
    expect(r.record.lines.at(-1)).toMatchObject({ speaker: "a", text: "(release) web/app.ts" });
  });
});

describe("the submit queue", () => {
  it("builds the next line of a session only after core answered the previous submit", async () => {
    const order: string[] = [];
    let answer: () => void = () => {};
    const queue = createSubmitQueue({
      commands: {
        execute: (_name, params) => {
          order.push(`submit ${params.text}`);
          return new Promise((resolve) => (answer = () => resolve({})));
        },
      },
    });
    const first = queue.submit("s-a", () => (order.push("build 1"), { text: "1", accepted: () => order.push("accepted 1") }));
    const second = queue.submit("s-a", () => (order.push("build 2"), { text: "2", accepted: () => order.push("accepted 2") }));
    await flush();
    expect(order).toEqual(["build 1", "submit 1"]);
    answer();
    await flush();
    answer();
    await Promise.all([first, second]);
    expect(order).toEqual(["build 1", "submit 1", "accepted 1", "build 2", "submit 2", "accepted 2"]);
  });
});

describe("the paths of a report (docs/spec/room.md#work-reports)", () => {
  it("refuses a report that names paths the reporter has not claimed in its open turn, and accepts claimed paths", () => {
    const r = room({ "s-a": "working", "s-b": "working" });
    const earlier = r.answers.open("s-a", "a", 0);
    r.work.claim({ turn: earlier.turn, paths: ["src"] });
    r.answers.deliver({ turn: earlier.turn, text: "done", status: "continue" });
    const a = r.answers.open("s-a", "a", 0);
    expect(() => r.work.reportCommand({ turn: a.turn, text: "changed", paths: ["src/ws.js", "package.json"] })).toThrow(
      "paths src/ws.js, package.json are not claimed by a",
    );
    r.work.claim({ turn: a.turn, paths: ["src"] });
    expect(() => r.work.reportCommand({ turn: a.turn, text: "changed", paths: ["package.json"] })).toThrow("paths package.json are not claimed by a");
    expect(r.work.reportCommand({ turn: a.turn, text: "changed", paths: ["src/ws.js"] })).toEqual({ turn: a.turn });
    expect(r.record.lines.at(-1)).toMatchObject({ speaker: "a", text: "(report) changed [src/ws.js]" });
  });
});

describe("an owner line during a relay (docs/spec/room.md#owner-follow-up)", () => {
  it("is injected into a working session framed as an owner instruction, once", async () => {
    const r = room({ "s-a": "working", "s-b": "idle", "s-c": "blocked" });
    for (const m of MEMBERS) r.record.markSent(m.session, 0);
    r.record.append("owner", "also add a README");
    r.work.followUp();
    await flush();
    r.work.inject();
    await flush();
    expect(r.submitted).toEqual([{ session: "s-a", text: `${OWNER_INJECT_TEXT} | [@owner] also add a README` }]);
    expect(OWNER_INJECT_TEXT).toBe("[@clubhouse] 방장의 새 지시야. 하던 작업에 반영하고 다음 답에서 답해.");
  });

  it("reaches a blocked session when core.sessions shows it working again", async () => {
    const r = room({ "s-a": "idle", "s-b": "blocked", "s-c": "idle" });
    r.record.append("owner", "also add a README");
    r.work.followUp();
    await flush();
    expect(r.submitted).toEqual([]);
    r.set("s-b", "working");
    await flush();
    expect(r.submitted.map((entry) => entry.session)).toEqual(["s-b"]);
  });

  it("injects no owner line that is no follow-up, such as the message that started the relay", async () => {
    const r = room({ "s-a": "working", "s-b": "working", "s-c": "working" });
    r.record.append("owner", "build it");
    r.work.inject();
    await flush();
    expect(r.submitted).toEqual([]);
  });
});

describe("conversation first (docs/spec/room.md#conversation-first)", () => {
  it("submits no report, claim or release to any session, working, idle or blocked", async () => {
    const r = room({ "s-a": "working", "s-b": "working", "s-c": "blocked" });
    r.record.append("owner", "build it");
    for (const m of MEMBERS) r.record.markSent(m.session, 1);
    const turn = r.answers.open("s-a", "a", 1);
    r.work.claim({ turn: turn.turn, paths: ["src/api.ts"] });
    r.work.reportCommand({ turn: turn.turn, text: "I change src/api.ts", paths: ["src/api.ts"] });
    r.work.release({ turn: turn.turn, paths: ["src/api.ts"] });
    r.set("s-c", "working");
    await flush();
    expect(r.submitted).toEqual([]);
    expect(r.record.lines).toHaveLength(4);
  });
});

