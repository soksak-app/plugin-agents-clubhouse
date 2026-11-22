// The message relay of the room (C5) over the members' owned sessions: each member receives every room record line that it has not
// received (docs/spec/room.md#room-record), the next member starts after the previous turn has ended, and each member delivers its answer with the declared answer command
// (docs/spec/room.md#answer). The room port double answers with the declared shapes and moves a session through idle, working and idle
// as core would; the member of a session runs the answer command during its turn, before its program reports idle.
import { describe, expect, it } from "vitest";
import { TURN_RULE, conversationTurnsOf, relayInMode, type ConversationBound, type RelayPorts } from "./room-relay";
import { createRoomRecord, settledRelay, type RoomRecord } from "./room-record";
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
    sessions: () => sessions.map((entry) => ({ ...entry })),
    watchSessions: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  ports.lines = createSubmitQueue(ports);
  return { ports, submitted, submits, finish, status, bound };
}

// A conversation bound that never ends a relay early.
const OPEN: ConversationBound = { limit: 8, stopped: () => false, accepted: () => {} };

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
  mode: "turn" | "facil" | "simul",
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
    expect(answers).toEqual([{ id: "reviewer", text: reply, status: "settled" }]);
  });

  it("fails the turn of a member whose program reports idle without an answer, and the members after it receive nothing", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")], { replies: { "s-1": null } });
    await expect(relayInMode(core.ports, "turn", MEMBERS, "hi", roomRecord("hi"), OPEN)).rejects.toThrow(
      "member reviewer: the member ended its turn without an answer: it ran no soksak-plugin-agents-clubhouse.answer",
    );
    expect(core.submitted.map((entry) => entry.session)).toEqual(["s-1"]);
  });

  it("closes the turn after the answer, so a later answer of the same session is refused", async () => {
    const core = fakeCore([IDLE("s-1")]);
    await relayInMode(core.ports, "turn", [MEMBERS[0]], "hi", roomRecord("hi"), OPEN);
    expect(() => core.ports.answers.deliver({ status: "settled", turn: "t-1", text: "again" })).toThrow("turn t-1 is not an open turn of this room");
  });

  it("refuses a member that is working, with the member named, and submits nothing to it", async () => {
    const core = fakeCore([{ session: "s-1", program: { state: "working" } }]);
    await expect(relayInMode(core.ports, "turn", [MEMBERS[0]], "hi", roomRecord("hi"), OPEN)).rejects.toThrow("member reviewer: member is working");
    expect(core.submitted).toEqual([]);
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
    const core = fakeCore([IDLE("s-1")], { replies: { "s-1": null } });
    await expect(relayInMode(core.ports, "turn", [MEMBERS[0]], "hi", roomRecord("hi"), OPEN)).rejects.toThrow("member reviewer");
    expect(core.status.read().waiting).toEqual([]);
  });
});

describe("relayInMode (docs/spec/room.md#modes)", () => {
  it("turn: relays to each member one after another in roster order, labeled with the owner, with the earlier answers", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")]);
    const answers = await relayInMode(core.ports, "turn", MEMBERS, "hello", roomRecord("hello"), OPEN);
    expect(core.submitted).toEqual([
      { session: "s-1", text: "[@owner] hello | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, write nothing in your terminal | [@clubhouse] turn t-1" },
      { session: "s-2", text: "[@owner] hello | [@Claude] answer of s-1 | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, write nothing in your terminal | [@clubhouse] turn t-2" },
    ]);
    expect(answers.map((answer) => answer.id)).toEqual(["reviewer", "writer"]);
  });

  it("turn: a mention selects only the mentioned members in mention order", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")]);
    await relayInMode(core.ports, "turn", MEMBERS, "@codex first, then @claude", roomRecord("@codex first, then @claude"), OPEN);
    expect(core.submitted).toEqual([
      { session: "s-2", text: "[@owner] @codex first, then @claude | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, write nothing in your terminal | [@clubhouse] turn t-1" },
      { session: "s-1", text: "[@owner] @codex first, then @claude | [@Codex] answer of s-2 | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, write nothing in your terminal | [@clubhouse] turn t-2" },
    ]);
  });

  it("turn: an earlier answer of several lines reaches the next member as one line", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")], { replies: { "s-1": "one\ntwo" } });
    await relayInMode(core.ports, "turn", MEMBERS, "hello", roomRecord("hello"), OPEN);
    expect(core.submitted[1]).toEqual({ session: "s-2", text: "[@owner] hello | [@Claude] one two | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, write nothing in your terminal | [@clubhouse] turn t-2" });
  });

  it("facil: relays to the first idle member in roster order only", async () => {
    const core = fakeCore([{ session: "s-1", program: { state: "working" } }, IDLE("s-2")]);
    const answers = await relayInMode(core.ports, "facil", MEMBERS, "who takes this", roomRecord("who takes this"), OPEN);
    expect(core.submitted).toEqual([{ session: "s-2", text: "[@owner] who takes this | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, write nothing in your terminal | [@clubhouse] turn t-1" }]);
    expect(answers.map((answer) => answer.id)).toEqual(["writer"]);
  });

  it("facil: a mentioned member takes the first turn and the other members follow", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")]);
    await relayInMode(core.ports, "facil", MEMBERS, "@Codex please", roomRecord("@Codex please"), OPEN);
    expect(core.submitted.map((entry) => entry.session)).toEqual(["s-2", "s-1"]);
  });

  it("facil: refuses the send when no member is idle", async () => {
    const core = fakeCore([{ session: "s-1", program: { state: "working" } }, { session: "s-2", program: null }]);
    await expect(relayInMode(core.ports, "facil", MEMBERS, "hi", roomRecord("hi"), OPEN)).rejects.toThrow("no member is idle");
    expect(core.submitted).toEqual([]);
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
    expect(core.submitted.map((entry) => entry.text)).toEqual(["[@owner] all at once | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, write nothing in your terminal | [@clubhouse] turn t-1", "[@owner] all at once | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, write nothing in your terminal | [@clubhouse] turn t-2"]);
  });

  it("simul: lets the other turns end and rejects with the first failure in member order", async () => {
    const core = fakeCore([{ session: "s-1", program: { state: "working" } }, IDLE("s-2")]);
    await expect(relayInMode(core.ports, "simul", MEMBERS, "hi", roomRecord("hi"), OPEN)).rejects.toThrow("member reviewer: member is working");
    expect(core.submitted.map((entry) => entry.session)).toEqual(["s-2"]);
  });
});

describe("the room record across turns (docs/spec/room.md#room-record)", () => {
  it("turn: at its next turn each member receives the answers given after it and the new message, in record order", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2"), IDLE("s-3")]);
    const record = roomRecord();
    await send(core, "turn", THREE, record, "introduce yourselves");
    await send(core, "turn", THREE, record, "what did the others say");
    expect(core.submitted.slice(3)).toEqual([
      { session: "s-1", text: "[@Codex] answer of s-2 | [@Tester] answer of s-3 | [@clubhouse] the conversation settled | [@owner] what did the others say | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, write nothing in your terminal | [@clubhouse] turn t-4" },
      { session: "s-2", text: "[@Tester] answer of s-3 | [@clubhouse] the conversation settled | [@owner] what did the others say | [@Claude] answer of s-1 | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, write nothing in your terminal | [@clubhouse] turn t-5" },
      { session: "s-3", text: "[@clubhouse] the conversation settled | [@owner] what did the others say | [@Claude] answer of s-1 | [@Codex] answer of s-2 | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, write nothing in your terminal | [@clubhouse] turn t-6" },
    ]);
    expect(record.delivered()).toEqual({ "s-1": 6, "s-2": 7, "s-3": 8 });
  });

  it("simul: at its next turn each member receives the answers of the other members of the earlier relay", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")]);
    const record = roomRecord();
    await send(core, "simul", MEMBERS, record, "first");
    await send(core, "simul", MEMBERS, record, "second");
    expect(core.submitted.slice(2).map((entry) => entry.text)).toEqual([
      "[@Codex] answer of s-2 | [@clubhouse] the conversation settled | [@owner] second | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, write nothing in your terminal | [@clubhouse] turn t-3",
      "[@Claude] answer of s-1 | [@clubhouse] the conversation settled | [@owner] second | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, write nothing in your terminal | [@clubhouse] turn t-4",
    ]);
  });

  it("the owner mentions B: B takes the first turn, then A and C in roster order, and A reads the answer of B (docs/spec/room.md#mentions)", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2"), IDLE("s-3")]);
    const record = roomRecord();
    await send(core, "turn", THREE, record, "@Codex 정리해 줘. 나머지는 보태 줘.");
    expect(core.submitted.map((entry) => entry.session)).toEqual(["s-2", "s-1", "s-3"]);
    expect(core.submitted[1].text).toBe("[@owner] @Codex 정리해 줘. 나머지는 보태 줘. | [@Codex] answer of s-2 | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, write nothing in your terminal | [@clubhouse] turn t-2");
  });

  it("a send whose submit core refused leaves no owner line, so repeated refused sends leave none", async () => {
    const core = fakeCore([IDLE("s-1")]);
    core.ports.commands.execute = async () => { throw new Error("core.session.submit refused"); };
    const record = roomRecord();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(send(core, "turn", [MEMBERS[0]], record, "same message")).rejects.toThrow("member reviewer: core.session.submit refused");
    }
    expect(record.lines).toEqual([]);
    expect(record.delivered()).toEqual({});
  });

  it("a send whose submit core accepted keeps the owner line and appends the failure line, and the delivered number stays without an answer", async () => {
    const core = fakeCore([IDLE("s-1")], { replies: { "s-1": null } });
    const record = roomRecord();
    await expect(send(core, "turn", [MEMBERS[0]], record, "hello")).rejects.toThrow("member reviewer: the member ended its turn");
    expect(record.lines).toEqual([
      { speaker: "owner", text: "hello" },
      { speaker: "clubhouse", text: "the relay failed: member reviewer: the member ended its turn without an answer: it ran no soksak-plugin-agents-clubhouse.answer" },
    ]);
    expect(record.delivered()).toEqual({});
  });

  it("a send that fails after an answer keeps the owner line, the answers that arrived and the failure line", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")], { replies: { "s-2": null } });
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
    expect(answers).toEqual([
      { id: "reviewer", text: "@Codex and @tester, your view?", status: "settled" },
      { id: "writer", text: "@Claude I disagree", status: "settled" },
      { id: "tester", text: "fine", status: "settled" },
      { id: "reviewer", text: "agreed", status: "settled" },
    ]);
    expect(core.submitted.map((entry) => entry.text)).toEqual([
      "[@owner] @claude start | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, write nothing in your terminal | [@clubhouse] turn t-1",
      "[@owner] @claude start | [@Claude] @Codex and @tester, your view? | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, write nothing in your terminal | [@clubhouse] turn t-2",
      "[@owner] @claude start | [@Claude] @Codex and @tester, your view? | [@Codex] @Claude I disagree | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, write nothing in your terminal | [@clubhouse] turn t-3",
      "[@Codex] @Claude I disagree | [@Tester] fine | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, write nothing in your terminal | [@clubhouse] turn t-4",
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
      relayInMode(core.ports, "facil", MEMBERS, "@claude ping", record, { limit: 2, stopped: () => false, accepted }),
    );
    // Claude and then Codex take the turns of the message; the mentions of the answers start the turns that the limit counts.
    expect(answers.map((answer) => answer.text)).toEqual(["@codex 1", "@claude 2", "@codex 3", "@claude 4"]);
    expect(record.lines.at(-1)).toEqual({ speaker: "clubhouse", text: "the conversation ended: it reached the limit of 2 member turns" });
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
    expect(record.lines.at(-1)).toEqual({ speaker: "clubhouse", text: "the conversation ended: the owner stopped it" });
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
    expect(core.submitted[0].text).toBe("[@owner] build it | [@clubhouse] roles: you are frontend; Codex: server, Tester: server | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, write nothing in your terminal | [@clubhouse] turn t-1");
    expect(core.submitted[1].text).toContain("[@clubhouse] roles: you are server; Claude: frontend, Tester: server | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, write nothing in your terminal | [@clubhouse] turn t-2");
  });

  it("states no roles when no member has one", async () => {
    const core = fakeCore([IDLE("s-1")]);
    await send(core, "turn", [MEMBERS[0]], roomRecord(), "hi");
    expect(core.submitted[0].text).toBe("[@owner] hi | [@clubhouse] answer through the room only: reply to the speakers, put a message to the owner in @owner:, write nothing in your terminal | [@clubhouse] turn t-1");
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
    expect(TURN_RULE).toBe("answer through the room only: reply to the speakers, put a message to the owner in @owner:, write nothing in your terminal");
  });
});
