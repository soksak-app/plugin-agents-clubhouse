// The message relay of the room (C5) over the members' owned sessions: each member receives every room record line that it has not
// received (docs/spec/room.md#room-record), the next member starts after the previous turn has ended, and each member delivers its answer with the declared answer command
// (docs/spec/room.md#answer). The room port double answers with the declared shapes and moves a session through idle, working and idle
// as core would; the member of a session runs the answer command during its turn, before its program reports idle.
import { describe, expect, it } from "vitest";
import { EMPTY_TURN_TEXT, TURN_RULE, conversationTurnsOf, relayInMode, type ConversationBound, type RelayPorts } from "./room-relay";
import { createRoomRecord, leaderRoute, settledRelay, type RoomRecord } from "./room-record";
import { createSubmitQueue } from "./submit-queue";
import { createAnswerChannel } from "./answer";
import { createConversationStatus } from "./conversation-status";

interface FakeSession { session: string; program: { state: "idle" | "working" | "blocked" } | null }

function fakeCore(
  initial: FakeSession[],
  options: { stuckOn?: string; vanishOn?: string; manual?: boolean; replies?: Record<string, string | null>; script?: Record<string, string[]> } = {},
) {
  let sessions: FakeSession[] = initial.map((entry) => ({ ...entry }));
  const listeners = new Set<(value: unknown) => void>();
  const submitted: { session: string; text: string }[] = [];
  const waiters: { count: number; resolve: () => void }[] = [];
  let next = 0;
  // The record whose delivered numbers the answers raise; send binds it.
  const bound: { record: RoomRecord | null } = { record: null };
  const answers = createAnswerChannel({
    newTurn: () => `t-${++next}`,
    delivered: (session, count) => bound.record?.markDelivered(session, count),
    restoredAnswer: () => {},
    changed: () => {},
  });
  // The open turn token of each session, which the relayed line carries.
  const turns = new Map<string, string>();
  // Resolves when the given number of lines has been submitted, so a test reads the submits of parallel turns without a timer.
  const submits = (count: number) => new Promise<void>((resolve) => (submitted.length >= count ? resolve() : waiters.push({ count, resolve })));
  const publish = () => { for (const listener of [...listeners]) listener(sessions.map((entry) => ({ ...entry }))); };
  const setState = (session: string, state: "idle" | "working" | "blocked") => {
    sessions = sessions.map((entry) => (entry.session === session ? { ...entry, program: { state } } : entry));
    publish();
  };
  // The member runs the answer command, unless its reply is null, and then its program reports idle.
  const finish = (session: string) => {
    const scripted = options.script?.[session]?.shift();
    const reply = scripted ?? (options.replies && session in options.replies ? options.replies[session] : `answer of ${session}`);
    if (reply !== null) answers.deliver({ status: "settled", turn: turns.get(session)!, text: reply });
    setState(session, "idle");
  };
  // The conversation status of the room is the tracker of the awaited members (docs/spec/room.md#conversation-status).
  const status = createConversationStatus([], () => sessions.map((entry) => ({ ...entry })), () => []);
  const ports: RelayPorts = {
    waiting: status.waiting,
    commands: {
      execute: async (name, params) => {
        const session = params.session as string;
        if (name === "core.session.submit") {
          const text = params.text as string;
          const token = /\[@clubhouse\] turn (\S+)$/.exec(text);
          if (token) turns.set(session, token[1]);
          submitted.push({ session, text });
          for (const waiter of waiters) if (submitted.length >= waiter.count) waiter.resolve();
          setState(session, "working");
          if (options.vanishOn === session) {
            sessions = sessions.filter((entry) => entry.session !== session);
            publish();
          } else if (options.stuckOn !== session && !options.manual) {
            // The turn ends in the next macrotask, after every microtask of the submit.
            setImmediate(() => finish(session));
          }
          return {};
        }
        throw new Error(`unexpected command ${name}`);
      },
    },
    answers,
    // Replaced below by the submit queue over these ports, so a test that replaces execute changes the submits too.
    lines: null as never,
    surface: "room-1",
    persisted: () => Promise.resolve(),
    sessions: () => sessions.map((entry) => ({ ...entry })),
    watchSessions: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  ports.lines = createSubmitQueue(ports);
  // The member runs the answer command with the status; its program state stays as it is (docs/spec/room.md#turn-end).
  const answer = (session: string, status: "continue" | "settled", text = `answer of ${session}`) =>
    answers.deliver({ status, turn: turns.get(session)!, text });
  return { ports, submitted, submits, finish, status, bound, setState, answer };
}

// A conversation bound that never ends a relay early.
const OPEN: ConversationBound = { limit: 8, stopped: () => false, accepted: () => {} };

const WORKING_ALL = (session: string): FakeSession => ({ session, program: { state: "working" } });

const IDLE = (session: string): FakeSession => ({ session, program: { state: "idle" } });

const MEMBERS = [{ id: "reviewer", name: "Claude", session: "s-1" }, { id: "writer", name: "Codex", session: "s-2" }];
const THREE = [...MEMBERS, { id: "tester", name: "Tester", session: "s-3" }];
const nameOf = (speaker: string): string => (speaker === "owner" ? "owner" : (THREE.find((member) => member.id === speaker)?.name ?? speaker));

// The record of a room after message.send accepted the message: the line of the owner is its last line.
function roomRecord(...messages: string[]): RoomRecord {
  const record = createRoomRecord([], {}, nameOf, () => {});
  for (const message of messages) record.append("owner", message);
  return record;
}

// Accepts the message as message.send does, then relays it.
function send(
  core: { ports: RelayPorts; bound: { record: RoomRecord | null } },
  mode: "turn" | "simul",
  members: typeof THREE,
  record: RoomRecord,
  message: string,
) {
  core.bound.record = record;
  record.append("owner", message);
  return settledRelay(record, (accepted) => relayInMode(core.ports, mode, members, message, record, { ...OPEN, accepted }));
}

describe("relayInMode one member at a time", () => {
  it("answers a reply of 451 lines, much taller than the member tab, whole and unchanged", async () => {
    const reply = Array.from({ length: 451 }, (_, index) => `row ${index}`).join("\n");
    const core = fakeCore([IDLE("s-1")], { replies: { "s-1": reply } });
    const answers = await relayInMode(core.ports, "turn", [MEMBERS[0]], "hello", roomRecord("hello"), OPEN);
    expect(answers).toMatchObject([{ id: "reviewer", text: reply, status: "settled" }]);
  });

  it("keeps the turn open when the program reports idle without an answer, and conversation.stop ends it (docs/spec/room.md#turn-end)", async () => {
    const stops = new Set<() => void>();
    let stopped = false;
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")], { replies: { "s-1": null } });
    const record = roomRecord("hi");
    const relay = relayInMode(core.ports, "turn", MEMBERS, "hi", record, {
      limit: 8,
      stopped: () => stopped,
      accepted: () => {},
      stopping: (listener) => (stops.add(listener), () => void stops.delete(listener)),
    });
    await core.submits(1);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(core.status.read().waiting).toEqual([{ member: "reviewer", session: "s-1", step: "answer", program: "idle" }]);
    stopped = true;
    for (const listener of [...stops]) listener();
    expect(await relay).toEqual([]);
    expect(core.submitted.map((entry) => entry.session)).toEqual(["s-1"]);
    expect(record.lines.at(-1)).toMatchObject({ speaker: "clubhouse", text: "the conversation ended: the owner stopped it" });
    expect(core.status.read().waiting).toEqual([]);
  });

  it("closes the turn after the answer, so a later answer of the same session is refused", async () => {
    const core = fakeCore([IDLE("s-1")]);
    await relayInMode(core.ports, "turn", [MEMBERS[0]], "hi", roomRecord("hi"), OPEN);
    expect(() => core.ports.answers.deliver({ status: "settled", turn: "t-1", text: "again" })).toThrow("turn t-1 is not an open turn of this room");
  });

  it("waits for a blocked member to leave the block, shows the wait with the step turn, and then relays (docs/spec/room.md#turn-end)", async () => {
    const core = fakeCore([{ session: "s-1", program: { state: "blocked" } }]);
    const relay = relayInMode(core.ports, "turn", [MEMBERS[0]], "hi", roomRecord("hi"), OPEN);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(core.submitted).toEqual([]);
    expect(core.status.read().waiting).toEqual([{ member: "reviewer", session: "s-1", step: "turn", program: "blocked" }]);
    core.setState("s-1", "idle");
    expect((await relay).map((answer) => answer.text)).toEqual(["answer of s-1"]);
    expect(core.status.read().waiting).toEqual([]);
  });

  it("conversation.stop ends the wait for a blocked member and records the stop", async () => {
    const stops = new Set<() => void>();
    let stopped = false;
    const core = fakeCore([{ session: "s-1", program: { state: "blocked" } }]);
    const record = roomRecord("hi");
    const relay = relayInMode(core.ports, "turn", [MEMBERS[0]], "hi", record, {
      limit: 8,
      stopped: () => stopped,
      accepted: () => {},
      stopping: (listener) => (stops.add(listener), () => void stops.delete(listener)),
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    stopped = true;
    for (const listener of [...stops]) listener();
    expect(await relay).toEqual([]);
    expect(core.submitted).toEqual([]);
    expect(record.lines.at(-1)).toMatchObject({ speaker: "clubhouse", text: "the conversation ended: the owner stopped it" });
    expect(core.status.read().waiting).toEqual([]);
  });

  it("fails with the reason when the session leaves core.sessions during its turn", async () => {
    const core = fakeCore([IDLE("s-1")], { vanishOn: "s-1" });
    await expect(relayInMode(core.ports, "turn", [MEMBERS[0]], "hi", roomRecord("hi"), OPEN)).rejects.toThrow("session s-1 is not open");
  });

  it("rejects with the member and the refusal of core when a submit is refused", async () => {
    const core = fakeCore([IDLE("s-1")]);
    core.ports.commands.execute = async () => { throw new Error("core.session.submit text must not contain CR or LF"); };
    await expect(relayInMode(core.ports, "turn", [MEMBERS[0]], "hi", roomRecord("hi"), OPEN)).rejects.toThrow(
      "member reviewer: core.session.submit text must not contain CR or LF",
    );
  });
});

describe("relayInMode waiting (docs/spec/room.md#conversation-status)", () => {
  it("names each member at the answer step from its submit until its answer arrives", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")], { manual: true });
    const relay = relayInMode(core.ports, "simul", MEMBERS, "hi", roomRecord("hi"), OPEN);
    await core.submits(2);
    expect(core.status.read().waiting).toEqual([
      { member: "reviewer", session: "s-1", step: "answer", program: "working" },
      { member: "writer", session: "s-2", step: "answer", program: "working" },
    ]);
    core.finish("s-1");
    // The turn of s-1 ends in the continuations of the answer; the next macrotask runs after them.
    await new Promise((resolve) => setImmediate(resolve));
    expect(core.status.read().waiting).toEqual([{ member: "writer", session: "s-2", step: "answer", program: "working" }]);
    core.finish("s-2");
    await relay;
    expect(core.status.read().waiting).toEqual([]);
  });

  it("ends the wait of a failed turn", async () => {
    const core = fakeCore([IDLE("s-1")], { vanishOn: "s-1" });
    await expect(relayInMode(core.ports, "turn", [MEMBERS[0]], "hi", roomRecord("hi"), OPEN)).rejects.toThrow("member reviewer");
    expect(core.status.read().waiting).toEqual([]);
  });
});

describe("relayInMode (docs/spec/room.md#modes)", () => {
  it("turn: relays to each member one after another in roster order, labeled with the owner, with the earlier answers", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")]);
    const answers = await relayInMode(core.ports, "turn", MEMBERS, "hello", roomRecord("hello"), OPEN);
    expect(core.submitted).toEqual([
      { session: "s-1", text: "[@clubhouse] 네 차례야. 아래는 네가 아직 못 본 기록이야. | [@owner] hello | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, end every step with the single text . and nothing else, also while background work runs | [@clubhouse] turn t-1" },
      { session: "s-2", text: "[@clubhouse] 네 차례야. 아래는 네가 아직 못 본 기록이야. | [@owner] hello | [@Claude] answer of s-1 | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, end every step with the single text . and nothing else, also while background work runs | [@clubhouse] turn t-2" },
    ]);
    expect(answers.map((answer) => answer.id)).toEqual(["reviewer", "writer"]);
  });

  it("turn: a mention selects only the mentioned members in mention order", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")]);
    await relayInMode(core.ports, "turn", MEMBERS, "@codex first, then @claude", roomRecord("@codex first, then @claude"), OPEN);
    expect(core.submitted).toEqual([
      { session: "s-2", text: "[@clubhouse] 네 차례야. 아래는 네가 아직 못 본 기록이야. | [@owner] @codex first, then @claude | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, end every step with the single text . and nothing else, also while background work runs | [@clubhouse] turn t-1" },
      { session: "s-1", text: "[@clubhouse] 네 차례야. 아래는 네가 아직 못 본 기록이야. | [@owner] @codex first, then @claude | [@Codex] answer of s-2 | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, end every step with the single text . and nothing else, also while background work runs | [@clubhouse] turn t-2" },
    ]);
  });

  it("turn: an earlier answer of several lines reaches the next member as one line", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")], { replies: { "s-1": "one\ntwo" } });
    await relayInMode(core.ports, "turn", MEMBERS, "hello", roomRecord("hello"), OPEN);
    expect(core.submitted[1]).toEqual({ session: "s-2", text: "[@clubhouse] 네 차례야. 아래는 네가 아직 못 본 기록이야. | [@owner] hello | [@Claude] one two | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, end every step with the single text . and nothing else, also while background work runs | [@clubhouse] turn t-2" });
  });




  it("simul: submits to every member before any turn ends and keeps roster order in the answers", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")], { manual: true });
    const relay = relayInMode(core.ports, "simul", MEMBERS, "all at once", roomRecord("all at once"), OPEN);
    await core.submits(2);
    expect(core.submitted.map((entry) => entry.session)).toEqual(["s-1", "s-2"]);
    core.finish("s-2");
    core.finish("s-1");
    const answers = await relay;
    expect(answers.map((answer) => answer.id)).toEqual(["reviewer", "writer"]);
    expect(core.submitted.map((entry) => entry.text)).toEqual(["[@clubhouse] 네 차례야. 아래는 네가 아직 못 본 기록이야. | [@owner] all at once | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, end every step with the single text . and nothing else, also while background work runs | [@clubhouse] turn t-1", "[@clubhouse] 네 차례야. 아래는 네가 아직 못 본 기록이야. | [@owner] all at once | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, end every step with the single text . and nothing else, also while background work runs | [@clubhouse] turn t-2"]);
  });

  it("simul: lets the other turns end and rejects with the first failure in member order", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")], { vanishOn: "s-1" });
    await expect(relayInMode(core.ports, "simul", MEMBERS, "hi", roomRecord("hi"), OPEN)).rejects.toThrow("member reviewer:");
    expect(core.submitted.map((entry) => entry.session)).toEqual(["s-1", "s-2"]);
  });

  it("simul: types into a working member at once and waits for a blocked member to leave the block", async () => {
    const core = fakeCore([{ session: "s-1", program: { state: "blocked" } }, { session: "s-2", program: { state: "working" } }]);
    const relay = relayInMode(core.ports, "simul", MEMBERS, "hi", roomRecord("hi"), OPEN);
    await core.submits(1);
    expect(core.submitted.map((entry) => entry.session)).toEqual(["s-2"]);
    core.setState("s-1", "idle");
    expect((await relay).map((answer) => answer.id)).toEqual(["reviewer", "writer"]);
  });
});

describe("the room record across turns (docs/spec/room.md#room-record)", () => {
  it("turn: at its next turn each member receives the answers given after it and the new message, in record order", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2"), IDLE("s-3")]);
    const record = roomRecord();
    await send(core, "turn", THREE, record, "introduce yourselves");
    await send(core, "turn", THREE, record, "what did the others say");
    expect(core.submitted.slice(3)).toEqual([
      { session: "s-1", text: "[@clubhouse] 네 차례야. 아래는 네가 아직 못 본 기록이야. | [@Codex] answer of s-2 | [@Tester] answer of s-3 | [@clubhouse] the conversation settled | [@owner] what did the others say | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, end every step with the single text . and nothing else, also while background work runs | [@clubhouse] turn t-4" },
      { session: "s-2", text: "[@clubhouse] 네 차례야. 아래는 네가 아직 못 본 기록이야. | [@Tester] answer of s-3 | [@clubhouse] the conversation settled | [@owner] what did the others say | [@Claude] answer of s-1 | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, end every step with the single text . and nothing else, also while background work runs | [@clubhouse] turn t-5" },
      { session: "s-3", text: "[@clubhouse] 네 차례야. 아래는 네가 아직 못 본 기록이야. | [@clubhouse] the conversation settled | [@owner] what did the others say | [@Claude] answer of s-1 | [@Codex] answer of s-2 | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, end every step with the single text . and nothing else, also while background work runs | [@clubhouse] turn t-6" },
    ]);
    expect(record.delivered()).toEqual({ "s-1": 6, "s-2": 7, "s-3": 8 });
  });

  it("simul: at its next turn each member receives the answers of the other members of the earlier relay", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")]);
    const record = roomRecord();
    await send(core, "simul", MEMBERS, record, "first");
    await send(core, "simul", MEMBERS, record, "second");
    expect(core.submitted.slice(2).map((entry) => entry.text)).toEqual([
      "[@clubhouse] 네 차례야. 아래는 네가 아직 못 본 기록이야. | [@Codex] answer of s-2 | [@clubhouse] the conversation settled | [@owner] second | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, end every step with the single text . and nothing else, also while background work runs | [@clubhouse] turn t-3",
      "[@clubhouse] 네 차례야. 아래는 네가 아직 못 본 기록이야. | [@Claude] answer of s-1 | [@clubhouse] the conversation settled | [@owner] second | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, end every step with the single text . and nothing else, also while background work runs | [@clubhouse] turn t-4",
    ]);
  });

  it("the owner mentions B: B takes the first turn, then A and C in roster order, and A reads the answer of B (docs/spec/room.md#mentions)", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2"), IDLE("s-3")]);
    const record = roomRecord();
    await send(core, "turn", THREE, record, "@Codex 정리해 줘. 나머지는 보태 줘.");
    expect(core.submitted.map((entry) => entry.session)).toEqual(["s-2", "s-1", "s-3"]);
    expect(core.submitted[1].text).toBe("[@clubhouse] 네 차례야. 아래는 네가 아직 못 본 기록이야. | [@owner] @Codex 정리해 줘. 나머지는 보태 줘. | [@Codex] answer of s-2 | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, end every step with the single text . and nothing else, also while background work runs | [@clubhouse] turn t-2");
  });

  it("a send whose submit core refused leaves no owner line, so repeated refused sends leave none", async () => {
    const core = fakeCore([IDLE("s-1")]);
    core.ports.commands.execute = async () => { throw new Error("core.session.submit refused"); };
    const record = roomRecord();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(send(core, "turn", [MEMBERS[0]], record, "same message")).rejects.toThrow("member reviewer: core.session.submit refused");
    }
    expect(record.lines).toMatchObject([]);
    expect(record.delivered()).toEqual({});
  });

  it("a send whose submit core accepted keeps the owner line and appends the failure line, and the delivered number stays without an answer", async () => {
    const core = fakeCore([IDLE("s-1")], { vanishOn: "s-1" });
    const record = roomRecord();
    await expect(send(core, "turn", [MEMBERS[0]], record, "hello")).rejects.toThrow("member reviewer: session s-1 is not open");
    expect(record.lines).toMatchObject([
      { speaker: "owner", text: "hello" },
      { speaker: "clubhouse", text: "the relay failed: member reviewer: session s-1 is not open" },
    ]);
    expect(record.delivered()).toEqual({});
  });

  it("a send that fails after an answer keeps the owner line, the answers that arrived and the failure line", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")], { vanishOn: "s-2" });
    const record = roomRecord();
    await expect(send(core, "turn", MEMBERS, record, "hello")).rejects.toThrow("member writer");
    expect(record.lines.map((line) => line.speaker)).toEqual(["owner", "reviewer", "clubhouse"]);
  });
});

describe("the conversation of the members (docs/spec/room.md#conversation)", () => {
  it("relays to each member that an answer mentions, in mention order, with the lines it has not received, until no answer mentions", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2"), IDLE("s-3")], {
      script: { "s-1": ["@Codex and @tester, your view?", "agreed"], "s-2": ["@Claude I disagree"], "s-3": ["fine"] },
    });
    const record = roomRecord();
    const answers = await send(core, "turn", THREE, record, "@claude start");
    expect(answers).toMatchObject([
      { id: "reviewer", text: "@Codex and @tester, your view?", status: "settled" },
      { id: "writer", text: "@Claude I disagree", status: "settled" },
      { id: "tester", text: "fine", status: "settled" },
      { id: "reviewer", text: "agreed", status: "settled" },
    ]);
    expect(core.submitted.map((entry) => entry.text)).toEqual([
      "[@clubhouse] 네 차례야. 아래는 네가 아직 못 본 기록이야. | [@owner] @claude start | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, end every step with the single text . and nothing else, also while background work runs | [@clubhouse] turn t-1",
      "[@clubhouse] 네 차례야. 아래는 네가 아직 못 본 기록이야. | [@owner] @claude start | [@Claude] @Codex and @tester, your view? | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, end every step with the single text . and nothing else, also while background work runs | [@clubhouse] turn t-2",
      "[@clubhouse] 네 차례야. 아래는 네가 아직 못 본 기록이야. | [@owner] @claude start | [@Claude] @Codex and @tester, your view? | [@Codex] @Claude I disagree | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, end every step with the single text . and nothing else, also while background work runs | [@clubhouse] turn t-3",
      "[@clubhouse] 네 차례야. 아래는 네가 아직 못 본 기록이야. | [@Codex] @Claude I disagree | [@Tester] fine | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, end every step with the single text . and nothing else, also while background work runs | [@clubhouse] turn t-4",
    ]);
  });

  it("ignores a mention of the speaker itself and of a name outside the members of the relay", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")], { script: { "s-1": ["@claude thinks, @nobody knows, @Tester is away"] } });
    const answers = await send(core, "turn", MEMBERS, roomRecord(), "@claude go");
    // The owner mentioned Claude, so Claude takes the first turn and Codex follows; the answer of Claude starts no further turn.
    expect(answers.map((answer) => answer.id)).toEqual(["reviewer", "writer"]);
    expect(core.submitted).toHaveLength(2);
  });

  it("queues no second turn for a member that already waits for a turn of the relay", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")], { script: { "s-1": ["@codex your turn"] } });
    const answers = await send(core, "turn", MEMBERS, roomRecord(), "everyone");
    expect(answers.map((answer) => answer.id)).toEqual(["reviewer", "writer"]);
  });

  it("ends the relay at the limit of member turns and records that the limit ended it", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")], {
      script: { "s-1": ["@codex 1", "@codex 3", "@codex 5"], "s-2": ["@claude 2", "@claude 4"] },
    });
    const record = roomRecord();
    record.append("owner", "@claude ping");
    const answers = await settledRelay(record, (accepted) =>
      relayInMode(core.ports, "turn", MEMBERS, "@claude ping", record, { limit: 2, stopped: () => false, accepted }),
    );
    // Claude and then Codex take the turns of the message; the mentions of the answers start the turns that the limit counts.
    expect(answers.map((answer) => answer.text)).toEqual(["@codex 1", "@claude 2", "@codex 3", "@claude 4"]);
    expect(record.lines.at(-1)).toMatchObject({ speaker: "clubhouse", text: "the conversation ended: it reached the limit of 2 member turns" });
    expect(core.status.read().waiting).toEqual([]);
  });

  it("starts no member turn with the limit 0 and records the limit", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")], { script: { "s-1": ["@codex next"] } });
    const record = roomRecord("@claude hi");
    const answers = await relayInMode(core.ports, "turn", MEMBERS, "@claude hi", record, { limit: 0, stopped: () => false, accepted: () => {} });
    expect(answers.map((answer) => answer.id)).toEqual(["reviewer", "writer"]);
    expect(record.lines.at(-1)?.speaker).toBe("clubhouse");
  });

  it("ends the relay after the current turn when the owner stops it, records the stop, and resolves with the answers", async () => {
    let stopped = false;
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")], { script: { "s-1": ["@codex next"] } });
    const record = roomRecord("@claude hi");
    const relay = relayInMode(core.ports, "turn", MEMBERS, "@claude hi", record, { limit: 8, stopped: () => stopped, accepted: () => {} });
    await core.submits(1);
    stopped = true;
    const answers = await relay;
    expect(answers.map((answer) => answer.id)).toEqual(["reviewer"]);
    expect(core.submitted).toHaveLength(1);
    expect(record.lines.at(-1)).toMatchObject({ speaker: "clubhouse", text: "the conversation ended: the owner stopped it" });
    expect(core.status.read().waiting).toEqual([]);
  });

  it("records that the conversation settled when it ended by itself (docs/spec/room.md#settling)", async () => {
    const core = fakeCore([IDLE("s-1")]);
    const record = roomRecord("hi");
    await relayInMode(core.ports, "turn", [MEMBERS[0]], "hi", record, { limit: 0, stopped: () => false, accepted: () => {} });
    expect(record.lines.map((line) => line.text)).toEqual(["hi", "answer of s-1", "the conversation settled"]);
  });

  it("simul: reads the mentions of the answers after every turn, in member order, and runs those turns one after another", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2"), IDLE("s-3")], {
      script: { "s-1": ["@tester check", "ok"], "s-2": ["@claude see", "unused"], "s-3": ["checked"] },
    });
    const answers = await send(core, "simul", THREE, roomRecord(), "all");
    expect(answers.map((answer) => answer.id)).toEqual(["reviewer", "writer", "tester", "tester", "reviewer"]);
    expect(core.submitted.slice(3).map((entry) => entry.session)).toEqual(["s-3", "s-1"]);
  });
});

describe("roles in the turn lines (docs/spec/room.md#roles)", () => {
  it("states the role of the member and the roles of the others in each turn line", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2"), IDLE("s-3")]);
    const roles = THREE.map((member, index) => ({ ...member, role: ["frontend", "server", "server"][index] }));
    await send(core, "turn", roles, roomRecord(), "build it");
    expect(core.submitted[0].text).toBe("[@clubhouse] 네 차례야. 아래는 네가 아직 못 본 기록이야. | [@owner] build it | [@clubhouse] roles: you are frontend; Codex: server, Tester: server | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, end every step with the single text . and nothing else, also while background work runs | [@clubhouse] turn t-1");
    expect(core.submitted[1].text).toContain("[@clubhouse] roles: you are server; Claude: frontend, Tester: server | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, end every step with the single text . and nothing else, also while background work runs | [@clubhouse] turn t-2");
  });

  it("states no roles when no member has one", async () => {
    const core = fakeCore([IDLE("s-1")]);
    await send(core, "turn", [MEMBERS[0]], roomRecord(), "hi");
    expect(core.submitted[0].text).toBe("[@clubhouse] 네 차례야. 아래는 네가 아직 못 본 기록이야. | [@owner] hi | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, end every step with the single text . and nothing else, also while background work runs | [@clubhouse] turn t-1");
  });
});

describe("conversationTurnsOf", () => {
  it("accepts an integer from 0 to 64 and refuses any other value with the setting named", () => {
    expect(conversationTurnsOf(0)).toBe(0);
    expect(conversationTurnsOf(64)).toBe(64);
    for (const value of [65, -1, 2.5, "8", undefined]) {
      expect(() => conversationTurnsOf(value)).toThrow(`settings.conversationTurns must be an integer from 0 to 64, got ${JSON.stringify(value)}`);
    }
  });
});

describe("the turn rule (docs/spec/room.md#room-protocol)", () => {
  it("each turn line states that the member says everything through the room", async () => {
    const core = fakeCore([IDLE("s-1")]);
    await send(core, "turn", [MEMBERS[0]], roomRecord(), "hi");
    expect(core.submitted[0].text).toContain(`[@clubhouse] ${TURN_RULE} | [@clubhouse] turn t-1`);
    expect(TURN_RULE).toBe("answer through the room only: reply to the speakers, put a message to the owner in @owner:, end every step with the single text . and nothing else, also while background work runs");
  });
});

describe("the times of the record (docs/spec/room.md#timing)", () => {
  it("records the time of each line and the time from the submit of the turn line to the answer", async () => {
    let clock = 0;
    const core = fakeCore([IDLE("s-1")]);
    const record = createRoomRecord([], {}, (speaker) => (speaker === "reviewer" ? "Claude" : speaker), () => {}, {}, () => (clock += 100));
    record.append("owner", "hi");
    await relayInMode(core.ports, "turn", [MEMBERS[0]], "hi", record, OPEN);
    const answer = record.lines.find((line) => line.speaker === "reviewer")!;
    expect(record.lines[0].at).toBe(100);
    expect(answer.elapsedMs).toBe(100);
    expect(answer.at).toBeGreaterThan(record.lines[0].at!);
  });
});

describe("an owner line during a relay (docs/spec/room.md#owner-follow-up)", () => {
  it("reaches the idle member in its next turn line once, and the member that answered before it takes a new round", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")], { manual: true });
    const record = roomRecord("build it");
    core.bound.record = record;
    const relay = relayInMode(core.ports, "turn", MEMBERS, "build it", record, OPEN);
    await core.submits(1);
    record.append("owner", "also add a README");
    core.finish("s-1");
    await core.submits(2);
    expect(core.submitted[1].text).toContain("[@owner] also add a README");
    core.finish("s-2");
    await core.submits(3);
    expect(core.submitted[2].session).toBe("s-1");
    expect(core.submitted[2].text).toContain("[@owner] also add a README");
    core.finish("s-1");
    await relay;
    const counts = core.submitted.map((entry) => entry.text.split("also add a README").length - 1);
    expect(counts).toEqual([0, 1, 1]);
    expect(record.lines.at(-1)).toMatchObject({ speaker: "clubhouse", text: "the conversation settled" });
  });
});

describe("a turn without new lines (docs/spec/room.md#room-record)", () => {
  it("runs when the member has received every line, carries no record line, and its status settles the conversation", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")]);
    const record = roomRecord("build it");
    core.bound.record = record;
    // The lines were injected while the sessions worked, so every line is sent before the turns.
    for (const member of MEMBERS) record.markSent(member.session, record.lines.length);
    const answers = await relayInMode(core.ports, "turn", MEMBERS, "build it", record, OPEN);
    expect(answers.map((answer) => answer.id)).toEqual(["reviewer", "writer"]);
    expect(core.submitted[0].text).toBe(`[@clubhouse] ${EMPTY_TURN_TEXT} | [@clubhouse] ${TURN_RULE} | [@clubhouse] turn t-1`);
    for (const entry of core.submitted) expect(entry.text).not.toContain("build it");
    expect(record.lines.at(-1)).toMatchObject({ speaker: "clubhouse", text: "the conversation settled" });
  });
});

// The turn lines of a conversation (docs/spec/room.md#conversation-first): the record reaches a member only in the line of its turn, a
// turn ends on its answer (docs/spec/room.md#turn-end), and no line is lost before the conversation settles.
describe("conversation first", () => {
  const WORKING = (session: string): FakeSession => ({ session, program: { state: "working" } });
  const tokenLine = /\| \[@clubhouse\] turn \S+$/;

  for (const mode of ["turn", "simul"] as const) {
    it(`submits only turn lines in ${mode}, each starting with the turn preface`, async () => {
      const core = fakeCore([IDLE("s-1"), IDLE("s-2")], { script: { "s-1": ["first of s-1"], "s-2": ["first of s-2"] } });
      const record = roomRecord("build it");
      core.bound.record = record;
      await relayInMode(core.ports, mode, MEMBERS, "build it", record, OPEN);
      expect(core.submitted.length).toBeGreaterThan(0);
      for (const entry of core.submitted) {
        expect(entry.text).toMatch(tokenLine);
        expect(entry.text.startsWith("[@clubhouse] 네 차례야.")).toBe(true);
      }
    });
  }

  it("ends a turn on its answer while the session stays working, and types the next turn line into the working session", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")], { manual: true });
    const record = roomRecord("build it");
    core.bound.record = record;
    const relay = relayInMode(core.ports, "turn", MEMBERS, "build it", record, OPEN);
    await core.submits(1);
    core.answer("s-1", "continue");
    await core.submits(2);
    expect(core.submitted[1].session).toBe("s-2");
    core.answer("s-2", "settled");
    // The round of the continuing member types into s-1, whose program still reports working.
    await core.submits(3);
    expect(core.submitted[2].session).toBe("s-1");
    core.answer("s-1", "settled");
    // The round gives every member a turn.
    await core.submits(4);
    core.answer("s-2", "settled");
    await relay;
    expect(record.lines.at(-1)).toMatchObject({ speaker: "clubhouse", text: "the conversation settled" });
  });

  // C114 (docs/spec/room.md#settling): a round in which no member has an unreceived line waits for the owner.
  it("waits for the owner instead of a round of empty turns when a member continues and nobody has an unreceived line", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")], { manual: true });
    const record = roomRecord("check it");
    core.bound.record = record;
    const relay = relayInMode(core.ports, "turn", [MEMBERS[0]], "check it", record, OPEN);
    await core.submits(1);
    core.answer("s-1", "continue", "@owner: which branch?");
    await relay;
    expect(core.submitted).toHaveLength(1);
    expect(record.lines.at(-1)).toMatchObject({ speaker: "clubhouse", text: "the conversation waits for the owner: @Claude continue" });
  });

  it("types no line into a blocked session until core.sessions shows it not blocked", async () => {
    const core = fakeCore([IDLE("s-1"), { session: "s-2", program: { state: "blocked" } }], { manual: true });
    const record = roomRecord("build it");
    core.bound.record = record;
    const relay = relayInMode(core.ports, "turn", MEMBERS, "build it", record, OPEN);
    await core.submits(1);
    core.answer("s-1", "settled");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(core.submitted.map((entry) => entry.session)).toEqual(["s-1"]);
    expect(core.status.read().waiting).toMatchObject([{ member: "writer", step: "turn" }]);
    core.setState("s-2", "working");
    await core.submits(2);
    expect(core.submitted[1].session).toBe("s-2");
    core.answer("s-2", "settled");
    await relay;
  });

  it("gives a member with an unreceived report one more turn before the conversation settles", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")], { manual: true });
    const record = roomRecord("build it");
    core.bound.record = record;
    const relay = relayInMode(core.ports, "turn", MEMBERS, "build it", record, OPEN);
    await core.submits(1);
    core.answer("s-1", "settled");
    await core.submits(2);
    record.append("writer", "(report) changed src/api.ts");
    core.answer("s-2", "settled");
    await core.submits(3);
    expect(core.submitted[2].session).toBe("s-1");
    expect(core.submitted[2].text).toContain("[@Codex] (report) changed src/api.ts");
    core.answer("s-1", "settled");
    await relay;
    // The settled answer of s-1 in its extra turn takes no turn of s-2; it reaches s-2 in its next turn.
    expect(core.submitted).toHaveLength(3);
    expect(record.lines.at(-1)).toMatchObject({ speaker: "clubhouse", text: "the conversation settled" });
  });

  it("delivers each record line once to each member over a whole conversation", async () => {
    const core = fakeCore([WORKING("s-1"), IDLE("s-2")], { manual: true });
    const record = roomRecord("build it");
    core.bound.record = record;
    const relay = relayInMode(core.ports, "turn", MEMBERS, "build it", record, OPEN);
    await core.submits(1);
    core.answer("s-1", "continue", "plan of s-1");
    await core.submits(2);
    record.append("writer", "(report) step of s-2");
    core.answer("s-2", "continue", "plan of s-2");
    await core.submits(3);
    core.answer("s-1", "settled", "done of s-1");
    await core.submits(4);
    core.answer("s-2", "settled", "done of s-2");
    await relay;
    for (const member of MEMBERS) {
      const received = core.submitted.filter((entry) => entry.session === member.session).map((entry) => entry.text).join(" | ");
      for (const line of record.lines) {
        if (line.speaker === member.id) continue;
        expect(received.split(line.text).length - 1, `${member.id}: ${line.text}`).toBeLessThanOrEqual(1);
      }
    }
    const firstOfS1 = core.submitted.filter((entry) => entry.session === "s-1").map((entry) => entry.text).join(" | ");
    for (const text of ["build it", "plan of s-2", "(report) step of s-2"]) expect(firstOfS1).toContain(text);
  });
});


describe("a relay with a leader (docs/spec/room.md#leader)", () => {
  const TEAM = [{ id: "lead", name: "Lead", session: "s-l" }, { id: "w1", name: "W1", session: "s-1" }, { id: "w2", name: "W2", session: "s-2" }];
  const leaderRecord = () => {
    const record = createRoomRecord([], {}, (speaker) => speaker, () => {}, {}, () => 0, {},
      leaderRoute(() => "s-l", () => TEAM));
    return record;
  };

  it("starts the leader first, starts the workers that one leader answer mentions together, and appends each answer on arrival", async () => {
    const core = fakeCore([IDLE("s-l"), IDLE("s-1"), IDLE("s-2")], { manual: true });
    const record = leaderRecord();
    core.bound.record = record;
    record.append("owner", "build a game");
    const relay = relayInMode(core.ports, "turn", TEAM, "build a game", record, { ...OPEN, leader: "lead" });
    await core.submits(1);
    expect(core.submitted[0].session).toBe("s-l");
    core.answer("s-l", "continue", "@W1 build the server | @W2 build the client");
    await core.submits(3);
    expect(core.submitted.slice(1).map((entry) => entry.session).sort()).toEqual(["s-1", "s-2"]);
    // A worker receives the owner line and the leader line that mentions it, and nothing else.
    expect(core.submitted[1].text).toContain("[@owner] build a game");
    core.answer("s-2", "settled", "client done");
    // The answer joins the record when it arrives, while the turn of W1 still runs.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(record.lines.at(-1)).toMatchObject({ speaker: "w2", text: "client done" });
    core.answer("s-1", "settled", "server done");
    await core.submits(4);
    expect(core.submitted[3].session).toBe("s-l");
    expect(core.submitted[3].text).toContain("client done");
    expect(core.submitted[3].text).toContain("server done");
    core.answer("s-l", "settled", "merged");
    await relay;
    expect(record.lines.at(-1)).toMatchObject({ speaker: "clubhouse", text: "the conversation settled" });
    // The answers of the workers mention no worker, so no worker received the line of the other.
    expect(core.submitted.filter((entry) => entry.session === "s-1").map((entry) => entry.text).join(" ")).not.toContain("client done");
  });

  // C114 (docs/spec/room.md#settling): a turn needs a line that the member has not received.
  it("gives the leader another turn when it continues with unreceived lines", async () => {
    const core = fakeCore([IDLE("s-l"), IDLE("s-1"), IDLE("s-2")], { manual: true });
    const record = leaderRecord();
    core.bound.record = record;
    record.append("owner", "plan it");
    const relay = relayInMode(core.ports, "turn", TEAM, "plan it", record, { ...OPEN, leader: "lead" });
    await core.submits(1);
    record.append("owner", "also add tests");
    core.answer("s-l", "continue", "thinking");
    await core.submits(2);
    expect(core.submitted[1].session).toBe("s-l");
    core.answer("s-l", "settled", "done");
    await relay;
    expect(core.submitted).toHaveLength(2);
  });

  it("waits for the owner instead of an empty turn when the leader continues with nothing unreceived", async () => {
    const core = fakeCore([IDLE("s-l"), IDLE("s-1"), IDLE("s-2")], { manual: true });
    const record = leaderRecord();
    core.bound.record = record;
    record.append("owner", "summon codex-dev");
    const relay = relayInMode(core.ports, "turn", TEAM, "summon codex-dev", record, { ...OPEN, leader: "lead" });
    await core.submits(1);
    core.answer("s-l", "continue", "@owner: codex-dev is not a definition; name another one");
    await relay;
    expect(core.submitted).toHaveLength(1);
    expect(record.lines.at(-1)).toMatchObject({ speaker: "clubhouse", text: "the conversation waits for the owner: @Lead continue" });
  });

  it("starts a worker that the relay gains after its start when the leader mentions it", async () => {
    const core = fakeCore([IDLE("s-l"), IDLE("s-1"), IDLE("s-2")], { manual: true });
    const record = leaderRecord();
    core.bound.record = record;
    record.append("owner", "go");
    const members = [TEAM[0]];
    const relay = relayInMode(core.ports, "turn", members, "go", record, { ...OPEN, leader: "lead", members: () => members });
    await core.submits(1);
    members.push(TEAM[1]);
    core.answer("s-l", "continue", "@W1 start");
    await core.submits(2);
    expect(core.submitted[1].session).toBe("s-1");
    core.answer("s-1", "settled", "ok");
    await core.submits(3);
    core.answer("s-l", "settled", "end");
    await relay;
  });
});

// C95 (docs/spec/room.md#mentions): `@all` addresses every checked member; only the owner and the leader start turns with it.
describe("@all", () => {
  const TEAM = [{ id: "lead", name: "Lead", session: "s-l" }, { id: "w1", name: "W1", session: "s-1" }, { id: "w2", name: "W2", session: "s-2" }];
  const leaderRecord = () => createRoomRecord([], {}, (speaker) => speaker, () => {}, {}, () => 0, {}, leaderRoute(() => "s-l", () => TEAM));
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
  const lead = (core: ReturnType<typeof fakeCore>, record: RoomRecord, message: string, bound: Partial<ConversationBound> = {}) => {
    core.bound.record = record;
    record.append("owner", message);
    return relayInMode(core.ports, "turn", TEAM, message, record, { ...OPEN, leader: "lead", ...bound });
  };

  it("an @all line enters the list of every checked worker once and of no unchecked member", () => {
    const record = leaderRecord();
    record.append("w1", "@all: the server is up");
    record.append("w1", "@all: the server is up again");
    expect(record.unsent("s-2", "w2")).toEqual([0, 1]);
    expect(record.unsent("s-l", "lead")).toEqual([0, 1]);
    expect(record.unsent("s-9", "gone")).toEqual([]);
  });

  it("an owner @all starts every worker in one batch and then the leader", async () => {
    const core = fakeCore([IDLE("s-l"), IDLE("s-1"), IDLE("s-2")], { manual: true });
    const record = leaderRecord();
    const relay = lead(core, record, "@all report");
    await core.submits(2);
    expect(core.submitted.map((entry) => entry.session).sort()).toEqual(["s-1", "s-2"]);
    core.answer("s-1", "settled", "one");
    core.answer("s-2", "settled", "two");
    await core.submits(3);
    expect(core.submitted[2].session).toBe("s-l");
    core.answer("s-l", "settled", "end");
    await relay;
  });

  it("an owner @W2 @all starts W2 first, then the rest in one batch, then the leader", async () => {
    const core = fakeCore([IDLE("s-l"), IDLE("s-1"), IDLE("s-2")], { manual: true });
    const record = leaderRecord();
    const relay = lead(core, record, "@W2 first, then @all");
    await core.submits(1);
    expect(core.submitted[0].session).toBe("s-2");
    core.answer("s-2", "settled", "two");
    await core.submits(2);
    expect(core.submitted[1].session).toBe("s-1");
    core.answer("s-1", "settled", "one");
    await core.submits(3);
    expect(core.submitted[2].session).toBe("s-l");
    core.answer("s-l", "settled", "end");
    await relay;
  });

  it("a leader answer with @all starts every worker in one batch", async () => {
    const core = fakeCore([IDLE("s-l"), IDLE("s-1"), IDLE("s-2")], { manual: true });
    const record = leaderRecord();
    const relay = lead(core, record, "go");
    await core.submits(1);
    core.answer("s-l", "continue", "@all build your part");
    await core.submits(3);
    expect(core.submitted.slice(1).map((entry) => entry.session).sort()).toEqual(["s-1", "s-2"]);
    core.answer("s-1", "settled", "one");
    core.answer("s-2", "settled", "two");
    await core.submits(4);
    core.answer("s-l", "settled", "end");
    await relay;
  });

  it("a worker answer with @all: starts no turn, and the other worker reads it in its next turn", async () => {
    const core = fakeCore([IDLE("s-l"), IDLE("s-1"), IDLE("s-2")], { manual: true });
    const record = leaderRecord();
    const relay = lead(core, record, "go");
    await core.submits(1);
    core.answer("s-l", "continue", "@W1 build the server");
    await core.submits(2);
    core.answer("s-1", "settled", "@all: the server is up");
    await core.submits(3);
    expect(core.submitted[2].session).toBe("s-l");
    core.answer("s-l", "continue", "@W2 build the client");
    await core.submits(4);
    expect(core.submitted[3].session).toBe("s-2");
    expect(core.submitted[3].text).toContain("the server is up");
    core.answer("s-2", "settled", "client");
    await core.submits(5);
    core.answer("s-l", "settled", "end");
    await relay;
  });

  it("two parallel workers that continue without mentioning each other give the next turn to the leader", async () => {
    const core = fakeCore([IDLE("s-l"), IDLE("s-1"), IDLE("s-2")], { manual: true });
    const record = leaderRecord();
    const relay = lead(core, record, "go");
    await core.submits(1);
    core.answer("s-l", "continue", "@W1 a | @W2 b");
    await core.submits(3);
    core.answer("s-1", "continue", "working on a");
    core.answer("s-2", "continue", "working on b");
    await core.submits(4);
    expect(core.submitted[3].session).toBe("s-l");
    core.answer("s-l", "settled", "end");
    await relay;
  });

  it("a worker answer that mentions the leader gives the leader the next turn before other worker turns", async () => {
    const core = fakeCore([IDLE("s-l"), IDLE("s-1"), IDLE("s-2")], { manual: true });
    const record = leaderRecord();
    const relay = lead(core, record, "go");
    await core.submits(1);
    core.answer("s-l", "continue", "@W1 a | @W2 b");
    await core.submits(3);
    // An owner follow-up during the batch leaves both workers with an unreceived line.
    record.append("owner", "also add tests");
    core.answer("s-2", "settled", "b done");
    await tick();
    core.answer("s-1", "continue", "@Lead which port?");
    await core.submits(4);
    expect(core.submitted[3].session).toBe("s-l");
    core.answer("s-l", "settled", "port 8080");
    // Then each worker with the unreceived owner line takes a turn, and the leader reads their answers.
    await core.submits(5);
    expect(core.submitted[4].session).toBe("s-1");
    core.answer("s-1", "settled", "ok");
    await core.submits(6);
    expect(core.submitted[5].session).toBe("s-2");
    core.answer("s-2", "settled", "ok");
    await core.submits(7);
    core.answer("s-l", "settled", "end");
    await relay;
  });

  it("the limit line of a leader relay names the members that still continue", async () => {
    const core = fakeCore([IDLE("s-l"), IDLE("s-1"), IDLE("s-2")], { manual: true });
    const record = leaderRecord();
    const relay = lead(core, record, "go", { limit: 1 });
    await core.submits(1);
    core.answer("s-l", "continue", "@all build");
    await relay;
    expect(record.lines.at(-1)).toMatchObject({
      speaker: "clubhouse",
      text: "the conversation ended without settling: it reached the limit of 1 member turns; @Lead continue",
    });
  });

  it("without a leader: simul runs every member at once and turn in roster order", async () => {
    const simul = fakeCore([IDLE("s-1"), IDLE("s-2"), IDLE("s-3")], { manual: true });
    const record = roomRecord("@all report");
    simul.bound.record = record;
    const relay = relayInMode(simul.ports, "simul", THREE, "@all report", record, OPEN);
    await simul.submits(3);
    for (const session of ["s-1", "s-2", "s-3"]) simul.answer(session, "settled", "ok");
    await relay;
    const turn = fakeCore([IDLE("s-1"), IDLE("s-2"), IDLE("s-3")]);
    await relayInMode(turn.ports, "turn", THREE, "@all report", roomRecord("@all report"), OPEN);
    expect(turn.submitted.map((entry) => entry.session)).toEqual(["s-1", "s-2", "s-3"]);
  });
});

// A reload of the room page before the tab state that holds a new token is written (C91-1): the member must never hold a token that
// the room cannot restore, so the room submits the turn line only after that write completed.
describe("the token is written before its turn line", () => {
  it("submits the turn line only after the tab state write of its token completed", async () => {
    const core = fakeCore([IDLE("s-1")], { manual: true });
    let release: () => void = () => {};
    const tokensAtWrite: number[] = [];
    core.ports.persisted = () => {
      tokensAtWrite.push(core.ports.answers.tokens().length);
      return new Promise<void>((resolve) => (release = resolve));
    };
    const record = roomRecord("go");
    core.bound.record = record;
    const relay = relayInMode(core.ports, "turn", [MEMBERS[0]], "go", record, OPEN);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(core.submitted).toHaveLength(0);
    expect(tokensAtWrite).toEqual([1]);
    release();
    await core.submits(1);
    core.answer("s-1", "settled");
    await relay;
  });
});
