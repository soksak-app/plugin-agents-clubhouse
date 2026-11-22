// The message relay of the room (C5) over the members' owned sessions: each member receives every room record line that it has not
// received (docs/spec/room.md#room-record), the next member starts after the previous turn has ended, and each member delivers its answer with the declared answer command
// (docs/spec/room.md#answer). The room port double answers with the declared shapes and moves a session through idle, working and idle
// as core would; the member of a session runs the answer command during its turn, before its program reports idle.
import { describe, expect, it } from "vitest";
import { relayInMode, type RelayPorts } from "./room-relay";
import { createRoomRecord, withdrawnOnFailure, type RoomRecord } from "./room-record";
import { createAnswerChannel } from "./answer";

interface FakeSession { session: string; program: { state: "idle" | "working" | "blocked" } | null }

function fakeCore(
  initial: FakeSession[],
  options: { stuckOn?: string; vanishOn?: string; manual?: boolean; replies?: Record<string, string | null> } = {},
) {
  let sessions: FakeSession[] = initial.map((entry) => ({ ...entry }));
  const listeners = new Set<(value: unknown) => void>();
  const submitted: { session: string; text: string }[] = [];
  const waiters: { count: number; resolve: () => void }[] = [];
  let next = 0;
  const answers = createAnswerChannel(() => `t-${++next}`);
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
    const reply = options.replies && session in options.replies ? options.replies[session] : `answer of ${session}`;
    if (reply !== null) answers.deliver({ turn: turns.get(session)!, text: reply });
    setState(session, "idle");
  };
  const ports: RelayPorts = {
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
    surface: "room-1",
    sessions: () => sessions.map((entry) => ({ ...entry })),
    watchSessions: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  return { ports, submitted, submits, finish };
}

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
function send(core: { ports: RelayPorts }, mode: "turn" | "facil" | "simul", members: typeof THREE, record: RoomRecord, message: string) {
  record.append("owner", message);
  return withdrawnOnFailure(record, () => relayInMode(core.ports, mode, members, message, record));
}

describe("relayInMode one member at a time", () => {
  it("answers a reply of 451 lines, much taller than the member tab, whole and unchanged", async () => {
    const reply = Array.from({ length: 451 }, (_, index) => `row ${index}`).join("\n");
    const core = fakeCore([IDLE("s-1")], { replies: { "s-1": reply } });
    const answers = await relayInMode(core.ports, "turn", [MEMBERS[0]], "hello", roomRecord("hello"));
    expect(answers).toEqual([{ id: "reviewer", text: reply }]);
  });

  it("fails the turn of a member whose program reports idle without an answer, and the members after it receive nothing", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")], { replies: { "s-1": null } });
    await expect(relayInMode(core.ports, "turn", MEMBERS, "hi", roomRecord("hi"))).rejects.toThrow(
      "member reviewer: the member ended its turn without an answer: it ran no soksak-plugin-agents-clubhouse.answer",
    );
    expect(core.submitted.map((entry) => entry.session)).toEqual(["s-1"]);
  });

  it("closes the turn after the answer, so a later answer of the same session is refused", async () => {
    const core = fakeCore([IDLE("s-1")]);
    await relayInMode(core.ports, "turn", [MEMBERS[0]], "hi", roomRecord("hi"));
    expect(() => core.ports.answers.deliver({ turn: "t-1", text: "again" })).toThrow("turn t-1 is not an open turn of this room");
  });

  it("refuses a member that is working, with the member named, and submits nothing to it", async () => {
    const core = fakeCore([{ session: "s-1", program: { state: "working" } }]);
    await expect(relayInMode(core.ports, "turn", [MEMBERS[0]], "hi", roomRecord("hi"))).rejects.toThrow("member reviewer: member is working");
    expect(core.submitted).toEqual([]);
  });

  it("fails with the reason when the session leaves core.sessions during its turn", async () => {
    const core = fakeCore([IDLE("s-1")], { vanishOn: "s-1" });
    await expect(relayInMode(core.ports, "turn", [MEMBERS[0]], "hi", roomRecord("hi"))).rejects.toThrow("session s-1 is not open");
  });

  it("rejects with the member and the refusal of core when a submit is refused", async () => {
    const core = fakeCore([IDLE("s-1")]);
    core.ports.commands.execute = async () => { throw new Error("core.session.submit text must not contain CR or LF"); };
    await expect(relayInMode(core.ports, "turn", [MEMBERS[0]], "hi", roomRecord("hi"))).rejects.toThrow(
      "member reviewer: core.session.submit text must not contain CR or LF",
    );
  });
});

describe("relayInMode (docs/spec/room.md#modes)", () => {
  it("turn: relays to each member one after another in roster order, labeled with the owner, with the earlier answers", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")]);
    const answers = await relayInMode(core.ports, "turn", MEMBERS, "hello", roomRecord("hello"));
    expect(core.submitted).toEqual([
      { session: "s-1", text: "[@owner] hello | [@clubhouse] turn t-1" },
      { session: "s-2", text: "[@owner] hello | [@Claude] answer of s-1 | [@clubhouse] turn t-2" },
    ]);
    expect(answers.map((answer) => answer.id)).toEqual(["reviewer", "writer"]);
  });

  it("turn: a mention selects only the mentioned members in mention order", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")]);
    await relayInMode(core.ports, "turn", MEMBERS, "@codex first, then @claude", roomRecord("@codex first, then @claude"));
    expect(core.submitted).toEqual([
      { session: "s-2", text: "[@owner] @codex first, then @claude | [@clubhouse] turn t-1" },
      { session: "s-1", text: "[@owner] @codex first, then @claude | [@Codex] answer of s-2 | [@clubhouse] turn t-2" },
    ]);
  });

  it("turn: an earlier answer of several lines reaches the next member as one line", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")], { replies: { "s-1": "one\ntwo" } });
    await relayInMode(core.ports, "turn", MEMBERS, "hello", roomRecord("hello"));
    expect(core.submitted[1]).toEqual({ session: "s-2", text: "[@owner] hello | [@Claude] one two | [@clubhouse] turn t-2" });
  });

  it("facil: relays to the first idle member in roster order only", async () => {
    const core = fakeCore([{ session: "s-1", program: { state: "working" } }, IDLE("s-2")]);
    const answers = await relayInMode(core.ports, "facil", MEMBERS, "who takes this", roomRecord("who takes this"));
    expect(core.submitted).toEqual([{ session: "s-2", text: "[@owner] who takes this | [@clubhouse] turn t-1" }]);
    expect(answers.map((answer) => answer.id)).toEqual(["writer"]);
  });

  it("facil: a mention names the member that receives the message", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")]);
    await relayInMode(core.ports, "facil", MEMBERS, "@Codex please", roomRecord("@Codex please"));
    expect(core.submitted.map((entry) => entry.session)).toEqual(["s-2"]);
  });

  it("facil: refuses the send when no member is idle", async () => {
    const core = fakeCore([{ session: "s-1", program: { state: "working" } }, { session: "s-2", program: null }]);
    await expect(relayInMode(core.ports, "facil", MEMBERS, "hi", roomRecord("hi"))).rejects.toThrow("no member is idle");
    expect(core.submitted).toEqual([]);
  });

  it("simul: submits to every member before any turn ends and keeps roster order in the answers", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")], { manual: true });
    const relay = relayInMode(core.ports, "simul", MEMBERS, "all at once", roomRecord("all at once"));
    await core.submits(2);
    expect(core.submitted.map((entry) => entry.session)).toEqual(["s-1", "s-2"]);
    core.finish("s-2");
    core.finish("s-1");
    const answers = await relay;
    expect(answers.map((answer) => answer.id)).toEqual(["reviewer", "writer"]);
    expect(core.submitted.map((entry) => entry.text)).toEqual(["[@owner] all at once | [@clubhouse] turn t-1", "[@owner] all at once | [@clubhouse] turn t-2"]);
  });

  it("simul: lets the other turns end and rejects with the first failure in member order", async () => {
    const core = fakeCore([{ session: "s-1", program: { state: "working" } }, IDLE("s-2")]);
    await expect(relayInMode(core.ports, "simul", MEMBERS, "hi", roomRecord("hi"))).rejects.toThrow("member reviewer: member is working");
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
      { session: "s-1", text: "[@Codex] answer of s-2 | [@Tester] answer of s-3 | [@owner] what did the others say | [@clubhouse] turn t-4" },
      { session: "s-2", text: "[@Tester] answer of s-3 | [@owner] what did the others say | [@Claude] answer of s-1 | [@clubhouse] turn t-5" },
      { session: "s-3", text: "[@owner] what did the others say | [@Claude] answer of s-1 | [@Codex] answer of s-2 | [@clubhouse] turn t-6" },
    ]);
    expect(record.delivered()).toEqual({ "s-1": 5, "s-2": 6, "s-3": 7 });
  });

  it("simul: at its next turn each member receives the answers of the other members of the earlier relay", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")]);
    const record = roomRecord();
    await send(core, "simul", MEMBERS, record, "first");
    await send(core, "simul", MEMBERS, record, "second");
    expect(core.submitted.slice(2).map((entry) => entry.text)).toEqual([
      "[@Codex] answer of s-2 | [@owner] second | [@clubhouse] turn t-3",
      "[@Claude] answer of s-1 | [@owner] second | [@clubhouse] turn t-4",
    ]);
  });

  it("a member that a mention left out receives the lines it missed at its next turn", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")]);
    const record = roomRecord();
    await send(core, "turn", MEMBERS, record, "@codex only you");
    await send(core, "turn", MEMBERS, record, "everyone now");
    expect(core.submitted[1]).toEqual({
      session: "s-1",
      text: "[@owner] @codex only you | [@Codex] answer of s-2 | [@owner] everyone now | [@clubhouse] turn t-2",
    });
  });

  it("a send that fails before any answer leaves no owner line, so repeated failed sends leave one line", async () => {
    const core = fakeCore([IDLE("s-1")], { replies: { "s-1": null } });
    const record = roomRecord();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(send(core, "turn", [MEMBERS[0]], record, "same message")).rejects.toThrow("member reviewer: the member ended its turn");
    }
    expect(record.lines).toEqual([]);
    expect(record.delivered()).toEqual({ "s-1": 0 });
  });

  it("a send that fails after an answer keeps the owner line and the answers that arrived", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")], { replies: { "s-2": null } });
    const record = roomRecord();
    await expect(send(core, "turn", MEMBERS, record, "hello")).rejects.toThrow("member writer");
    expect(record.lines).toEqual([{ speaker: "owner", text: "hello" }, { speaker: "reviewer", text: "answer of s-1" }]);
  });
});
