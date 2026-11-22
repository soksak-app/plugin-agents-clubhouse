// The invariants of the room record delivery (docs/spec/room.md#room-record, docs/spec/room.md#closing-delivery) over a table of
// scenarios: the three modes, a mention chain, the turn limit and the stop, a failed turn, a blocked member, a restart during a relay, and
// a send during a record wait. The room is composed as the page composes it: the record, the token channel, the relay, the conversation
// status and the closing delivery. The members are doubles of core and of the member programs: a submitted line turns the program
// working, the member answers or acknowledges the token of the line, and the program reports idle. After the relays and the waits each
// scenario asserts (a) delivered == length for every open session that is not pending, (b) the lines that each session received,
// joined, are the record without the lines of its own member, in record order and without a duplicate, and (c) no session had two open
// lines at once.
import { describe, expect, it } from "vitest";
import { createSubmitQueue } from "./submit-queue";
import { createAnswerChannel, type AnswerChannel, type OpenToken } from "./answer";
import { createConversationStatus, type ConversationStatus } from "./conversation-status";
import { createClosingDelivery, type ClosingDelivery } from "./closing-delivery";
import { createRoomRecord, settledRelay, type RecordLine, type RoomRecord } from "./room-record";
import { relayInMode, type RelayPorts } from "./room-relay";
import type { RoomMode } from "./commands";

type State = "idle" | "working" | "blocked";

const MEMBERS = [
  { id: "a", name: "Alpha", session: "s-a" },
  { id: "b", name: "Beta", session: "s-b" },
  { id: "c", name: "Gamma", session: "s-c" },
];
const nameOf = (speaker: string): string => (speaker === "owner" ? "owner" : speaker === "clubhouse" ? "clubhouse" : MEMBERS.find((m) => m.id === speaker)!.name);
const PREFACE = /^답은 하지말고 알고있어\. .*?참고해\. \| /;

interface Behaviour {
  // The answers of the member in order; a missing answer is `reply <n> of <id>`.
  answers?: string[];
  // The status of each answer in order; a missing status is settled.
  statuses?: ("continue" | "settled")[];
  // The turns (0-based) at which the program reports idle without an answer.
  failAt?: number[];
  // The member holds its lines until the test releases them.
  manual?: boolean;
  // The member holds its record lines until the test releases them.
  manualRecord?: boolean;
}

// The doubles of core and of the member programs. They outlive a restart of the room, as the sessions of core do.
function members(behaviour: Record<string, Behaviour> = {}) {
  let states: Record<string, State> = Object.fromEntries(MEMBERS.map((m) => [m.session, "idle"]));
  const listeners = new Set<(value: unknown) => void>();
  const value = () => Object.entries(states).map(([session, state]) => ({ session, program: { state } }));
  const set = (session: string, state: State) => {
    states = { ...states, [session]: state };
    for (const listener of [...listeners]) listener(value());
  };
  // The current token channel of the room; a restart replaces it.
  const room: { answers: AnswerChannel | null } = { answers: null };
  const open = new Map<string, number>();
  let violations = 0;
  // The lines that the room submitted to each session, and the number of them that an answer or an acknowledgement confirmed: an answer
  // or an acknowledgement confirms every line submitted before it (docs/spec/room.md#work-reports).
  const submittedBodies = new Map<string, string[]>();
  const confirmed = new Map<string, number>();
  const confirm = (session: string): void => void confirmed.set(session, (submittedBodies.get(session) ?? []).length);
  const received = {
    get: (session: string): string[] => (submittedBodies.get(session) ?? []).slice(0, confirmed.get(session) ?? 0),
  };
  const turnsOf = new Map<string, number>();
  const held: (() => void)[] = [];
  const act = (session: string, text: string): void => {
    const member = MEMBERS.find((m) => m.session === session)!;
    const own = behaviour[member.id] ?? {};
    const match = /\| \[@clubhouse\] (turn|record) (\S+)$/.exec(text)!;
    const body = text.slice(0, match.index - 1).replace(PREFACE, "");
    submittedBodies.set(session, [...(submittedBodies.get(session) ?? []), body]);
    const kind = match[1];
    const token = match[2];
    const done = (): void => {
      open.set(session, (open.get(session) ?? 1) - 1);
      set(session, "idle");
    };
    const take = (): void => {
      if (kind === "record") {
        room.answers!.ack({ turn: token });
        confirm(session);
        return done();
      }
      const index = turnsOf.get(session) ?? 0;
      turnsOf.set(session, index + 1);
      if (own.failAt?.includes(index)) return done();
      const reply = own.answers?.[index] ?? `reply ${index} of ${member.id}`;
      room.answers!.deliver({ status: own.statuses?.[index] ?? "settled", turn: token, text: reply });
      confirm(session);
      done();
    };
    if (own.manual || (kind === "record" && own.manualRecord)) held.push(take);
    else setImmediate(take);
  };
  const execute = async (name: string, params: Record<string, unknown>): Promise<unknown> => {
    if (name !== "core.session.submit") throw new Error(`unexpected command ${name}`);
    const session = params.session as string;
    const count = (open.get(session) ?? 0) + 1;
    if (count > 1) violations += 1;
    open.set(session, count);
    set(session, "working");
    act(session, params.text as string);
    return {};
  };
  return {
    room,
    set,
    value,
    listeners,
    execute,
    received,
    violations: () => violations,
    // Releases the held lines of the manual members.
    release: () => {
      for (const take of held.splice(0)) take();
    },
    // Discards the held lines of a session whose wait the room stopped: the program ends that turn without a command.
    drop: (session: string) => {
      held.splice(0);
      open.set(session, 0);
    },
    unhold: (id: string) => {
      behaviour[id] = { ...behaviour[id], manual: false, manualRecord: false };
    },
  };
}

type Core = ReturnType<typeof members>;

interface Room {
  record: RoomRecord;
  answers: AnswerChannel;
  status: ConversationStatus;
  delivery: ClosingDelivery;
  reports: string[];
  send(mode: RoomMode, text: string, options?: { limit?: number; stopAfter?: number }): Promise<unknown>;
  state(): { lines: RecordLine[]; delivered: Record<string, number>; turns: OpenToken[] };
}

// Composes the room as src/main.ts does, from a stored state after a restart.
function room(core: Core, saved: { lines: RecordLine[]; delivered: Record<string, number>; turns: OpenToken[] } = { lines: [], delivered: {}, turns: [] }): Room {
  const lines = [...saved.lines];
  const reports: string[] = [];
  let delivery: ClosingDelivery | null = null;
  let status: ConversationStatus | null = null;
  const record = createRoomRecord(lines, saved.delivered, nameOf, () => status?.changed());
  let next = 0;
  const answers = createAnswerChannel({
    newTurn: () => `t-${saved.turns.length}-${++next}`,
    restored: saved.turns,
    delivered: (session, count) => record.markDelivered(session, count),
    restoredAnswer: (token, text) => record.append(token.member, text),
    changed: () => delivery?.tokensChanged(),
  });
  core.room.answers = answers;
  status = createConversationStatus(lines, core.value, () => delivery?.entries() ?? []);
  const ports: RelayPorts = {
    commands: { execute: core.execute },
    answers,
    lines: createSubmitQueue({ commands: { execute: core.execute } }),
    surface: "room-1",
    sessions: core.value,
    watchSessions: (listener) => {
      core.listeners.add(listener);
      return () => void core.listeners.delete(listener);
    },
    waiting: status.waiting,
  };
  const report = (where: string, text: string) => void reports.push(`${where}: ${text}`);
  delivery = createClosingDelivery({ ...ports, report, changed: () => status!.changed() }, record, nameOf, () => MEMBERS);
  core.listeners.add((value) => delivery!.sessionsChanged(value));
  return {
    record,
    answers,
    status,
    delivery,
    reports,
    send(mode, text, options = {}) {
      record.append("owner", text);
      let turns = 0;
      const stopped = () => options.stopAfter !== undefined && turns >= options.stopAfter;
      const bound = { limit: options.limit ?? 8, stopped, accepted: () => {} };
      return delivery!.relay(() =>
        settledRelay(record, (accepted) =>
          relayInMode({ ...ports, waiting: (member, step) => { turns += 1; return status!.waiting(member, step); } }, mode, MEMBERS, text, record, { ...bound, accepted }),
        ),
      );
    },
    state: () => ({ lines: record.lines.map((line) => ({ ...line })), delivered: record.delivered(), turns: answers.tokens() }),
  };
}

// Resolves when the room has no open token and its delivery has run.
async function quiet(r: Room): Promise<void> {
  for (;;) {
    await r.delivery.run();
    if (r.answers.tokens().length === 0) return;
    await new Promise<void>((resolve) => {
      const check = () => {
        if (r.answers.tokens().length === 0) resolve();
      };
      void Promise.all(MEMBERS.map((m) => r.answers.settled(m.session))).then(check);
    });
  }
}

function invariants(core: Core, r: Room): void {
  const value = r.status.read();
  // (a) every open session that is not pending has received the whole record.
  for (const entry of value.delivery) {
    if (!entry.pending) expect(entry, `delivery of ${entry.session}`).toMatchObject({ delivered: entry.length });
  }
  // (b) the received lines of each session are the record without its own lines, in order and once.
  for (const member of MEMBERS) {
    const expected = r.record.lines.filter((line) => line.speaker !== member.id).map((line) => `[@${nameOf(line.speaker)}] ${line.text.replace(/\n/g, " ")}`);
    const got = core.received.get(member.session).flatMap((body) => body.split(" | "));
    expect(got, `lines of ${member.session}`).toEqual(expected);
  }
  // (c) no session had two open lines at once.
  expect(core.violations()).toBe(0);
  expect(value.waiting).toEqual([]);
}

const MODES: RoomMode[] = ["turn", "facil", "simul"];

describe.each(MODES)("the delivery invariants in %s", (mode) => {
  it("plain messages: after each relay every session has received the whole record", async () => {
    const core = members();
    const r = room(core);
    for (const text of ["first", "second", "third"]) {
      await r.send(mode, text);
      await quiet(r);
      invariants(core, r);
    }
  });

  it("a mention chain: every turn line and the closing delivery carry the lines in order", async () => {
    const core = members({ a: { answers: ["@Beta your view?", "agreed"] }, b: { answers: ["@Alpha I differ, @Gamma?"] }, c: { answers: ["fine"] } });
    const r = room(core);
    await r.send(mode, "@Alpha start");
    await quiet(r);
    invariants(core, r);
    await r.send(mode, "summary");
    await quiet(r);
    invariants(core, r);
  });

  it("the turn limit: the session that received only the limit line receives it in the closing delivery", async () => {
    const core = members({ a: { answers: ["@Beta 1", "@Beta 3"] }, b: { answers: ["@Alpha 2", "@Alpha 4"] } });
    const r = room(core);
    await r.send(mode, "@Alpha ping", { limit: 1 });
    await quiet(r);
    expect(r.record.lines.some((line) => line.speaker === "clubhouse" && line.text.includes("reached the limit of 1"))).toBe(true);
    invariants(core, r);
  });

  it("the stop of the owner: the stop line reaches every session", async () => {
    const core = members({ a: { answers: ["@Beta go"] } });
    const r = room(core);
    await r.send(mode, "@Alpha begin", { stopAfter: 1 });
    await quiet(r);
    expect(r.record.lines.at(-1)).toEqual({ speaker: "clubhouse", text: "the conversation ended: the owner stopped it" });
    invariants(core, r);
  });

  it("a failed turn: the failure line reaches every session, the failed one by its closing delivery", async () => {
    const core = members({ b: { failAt: [0] } });
    const r = room(core);
    await expect(r.send(mode, mode === "facil" ? "@Beta and @Gamma" : "hello")).rejects.toThrow("member b:");
    await quiet(r);
    expect(r.record.lines.some((line) => line.speaker === "clubhouse" && line.text.startsWith("the relay failed: member b:"))).toBe(true);
    invariants(core, r);
    await r.send(mode, "again");
    await quiet(r);
    invariants(core, r);
  });

  it("a blocked member is pending at the closing delivery and receives its lines at its next idle", async () => {
    const core = members();
    const r = room(core);
    await r.send(mode, "first");
    await quiet(r);
    core.set("s-c", "blocked");
    // facil relays to the first idle member only; turn and simul relay to Gamma too, whose blocked turn fails the relay.
    if (mode === "facil") await r.send(mode, "next");
    else await expect(r.send(mode, "next")).rejects.toThrow("member c: member waits for an answer: its program is blocked");
    await quiet(r);
    expect(r.status.read().delivery.find((entry) => entry.session === "s-c")).toMatchObject({ pending: true });
    expect(r.reports).toContain("room record: member c is blocked");
    core.set("s-c", "idle");
    await quiet(r);
    expect(r.status.read().delivery.find((entry) => entry.session === "s-c")).toMatchObject({ pending: false });
    invariants(core, r);
  });

  it("a restart during a relay: the answer of a kept token is the answer of its member, and every session receives the rest", async () => {
    const core = members({ a: { manual: true } });
    const first = room(core);
    void first.send(mode, "before the restart").catch(() => {});
    // The relay waits for the held line of Alpha; the room stops with it and starts again from its tab state.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    const saved = JSON.parse(JSON.stringify(first.state()));
    expect(saved.turns.some((token: OpenToken) => token.session === "s-a")).toBe(true);
    core.listeners.clear();
    const r = room(core, saved);
    expect(r.status.read().waiting.map((wait) => wait.session)).toContain("s-a");
    core.unhold("a");
    core.release();
    await quiet(r);
    invariants(core, r);
    await r.send(mode, "after the restart");
    await quiet(r);
    invariants(core, r);
  });

  it("a send during a record wait: the turn line of the member follows its acknowledgement", async () => {
    const core = members({ c: { manualRecord: true } });
    const r = room(core);
    await r.send(mode, "@Alpha first");
    await r.delivery.run();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(r.status.read().waiting).toEqual([{ member: "c", session: "s-c", step: "record", program: "working" }]);
    const second = r.send(mode, "everyone");
    await new Promise<void>((resolve) => setImmediate(resolve));
    core.unhold("c");
    core.release();
    await second;
    await quiet(r);
    invariants(core, r);
  });
});

describe("the stop of a record wait (docs/spec/room.md#closing-delivery)", () => {
  it("ends the wait, reports it, keeps the delivered number and holds the session until the next relay", async () => {
    const core = members({ c: { manualRecord: true } });
    const r = room(core);
    await r.send("turn", "@Alpha first");
    await r.delivery.run();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const before = r.record.delivered()["s-c"];
    expect(r.delivery.waits()).toBe(true);
    expect(r.delivery.stopWaits()).toBe(1);
    expect(r.reports).toContain("room record: member c: record wait stopped");
    expect(r.status.read().waiting).toEqual([]);
    expect(r.record.delivered()["s-c"]).toBe(before);
    core.set("s-c", "idle");
    await r.delivery.run();
    expect(r.answers.has("s-c")).toBe(false);
    core.drop("s-c");
    core.unhold("c");
    await r.send("turn", "next");
    await quiet(r);
    expect(r.record.delivered()["s-c"]).toBe(r.record.lines.length);
  });
});

// The rounds of a conversation (docs/spec/room.md#settling): while a member declares continue, the room opens a round of every member,
// so one owner message runs the conversation to its end without a further send.
describe.each(MODES)("the rounds until settled in %s", (mode) => {
  it("the first member answers continue and the conclusion comes after its turn: it receives the conclusion and takes the next round", async () => {
    const core = members({
      a: { answers: ["open question: the scope", "agreed with the conclusion"], statuses: ["continue", "settled"] },
      b: { answers: ["the scope is the API", "ok"], statuses: ["settled", "settled"] },
      c: { answers: ["conclusion: the API only", "ok"], statuses: ["settled", "settled"] },
    });
    const r = room(core);
    await r.send(mode === "facil" ? "turn" : mode, "@Alpha @Beta @Gamma discuss");
    await quiet(r);
    const alpha = core.received.get("s-a").join(" | ");
    expect(alpha).toContain("[@Gamma] conclusion: the API only");
    expect(r.record.lines.filter((line) => line.speaker === "a").map((line) => line.text)).toEqual(["open question: the scope", "agreed with the conclusion"]);
    expect(r.record.lines.at(-1)).toEqual({ speaker: "clubhouse", text: "the conversation settled" });
    invariants(core, r);
  });

  it("one owner message runs several rounds to settled with no further send", async () => {
    const core = members({
      a: { statuses: ["continue", "continue", "settled"] },
      b: { statuses: ["continue", "settled", "settled"] },
      c: { statuses: ["settled", "settled", "settled"] },
    });
    const r = room(core);
    await r.send(mode === "facil" ? "turn" : mode, "build the feature");
    await quiet(r);
    expect(r.record.lines.filter((line) => line.speaker === "a")).toHaveLength(3);
    expect(r.record.lines.at(-1)).toEqual({ speaker: "clubhouse", text: "the conversation settled" });
    invariants(core, r);
  });

  it("the limit ends a conversation that does not settle and names the members that continue", async () => {
    const core = members({ a: { statuses: ["continue", "continue", "continue"] } });
    const r = room(core);
    await r.send(mode === "facil" ? "turn" : mode, "go", { limit: 3 });
    await quiet(r);
    expect(r.record.lines.at(-1)).toEqual({
      speaker: "clubhouse",
      text: "the conversation ended without settling: it reached the limit of 3 member turns; @Alpha continue",
    });
    invariants(core, r);
  });
});
