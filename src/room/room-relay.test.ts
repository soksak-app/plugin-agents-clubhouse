// The message relay of the room (C5) over the members' owned sessions: each room message is submitted to each member in roster order,
// the next member starts after the previous turn has ended, and the screen of each member is read as its answer. The room port double
// answers with the declared shapes and moves a session through idle, working and idle as core would.
import { describe, expect, it } from "vitest";
import { relayInMode, relayToMembers, type RelayPorts } from "./room-relay";

interface FakeSession { session: string; program: { state: "idle" | "working" | "blocked" } | null }

function fakeCore(initial: FakeSession[], options: { stuckOn?: string; vanishOn?: string; manual?: boolean } = {}) {
  let sessions: FakeSession[] = initial.map((entry) => ({ ...entry }));
  const listeners = new Set<(value: unknown) => void>();
  const submitted: { session: string; text: string }[] = [];
  const waiters: { count: number; resolve: () => void }[] = [];
  // Resolves when the given number of lines has been submitted, so a test reads the submits of parallel turns without a timer.
  const submits = (count: number) => new Promise<void>((resolve) => (submitted.length >= count ? resolve() : waiters.push({ count, resolve })));
  const publish = () => { for (const listener of [...listeners]) listener(sessions.map((entry) => ({ ...entry }))); };
  const setState = (session: string, state: "idle" | "working" | "blocked") => {
    sessions = sessions.map((entry) => (entry.session === session ? { ...entry, program: { state } } : entry));
    publish();
  };
  const ports: RelayPorts = {
    commands: {
      execute: async (name, params) => {
        if (name === "core.session.submit") {
          submitted.push({ session: params.session as string, text: params.text as string });
          for (const waiter of waiters) if (submitted.length >= waiter.count) waiter.resolve();
          const session = params.session as string;
          setState(session, "working");
          if (options.vanishOn === session) {
            sessions = sessions.filter((entry) => entry.session !== session);
            publish();
          } else if (options.stuckOn !== session && !options.manual) {
            queueMicrotask(() => setState(session, "idle"));
          }
          return {};
        }
        if (name === "core.session.read") {
          return { rows: [`answer of ${params.session}`, ""], cursor: { row: 0, column: 0 } };
        }
        throw new Error(`unexpected command ${name}`);
      },
    },
    sessions: () => sessions.map((entry) => ({ ...entry })),
    watchSessions: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  return { ports, submitted, submits, finish: (session: string) => setState(session, "idle") };
}

const IDLE = (session: string): FakeSession => ({ session, program: { state: "idle" } });

describe("relayToMembers", () => {
  it("submits the message to each member in order, waits for each turn, and returns the screen of each member", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")]);
    const answers = await relayToMembers(core.ports, [{ id: "reviewer", session: "s-1" }, { id: "writer", session: "s-2" }], "hello");
    expect(core.submitted).toEqual([{ session: "s-1", text: "hello" }, { session: "s-2", text: "hello" }]);
    expect(answers).toEqual([
      { id: "reviewer", rows: ["answer of s-1", ""] },
      { id: "writer", rows: ["answer of s-2", ""] },
    ]);
  });

  it("refuses a member that is working, with the member named, and submits nothing to it", async () => {
    const core = fakeCore([{ session: "s-1", program: { state: "working" } }]);
    await expect(relayToMembers(core.ports, [{ id: "reviewer", session: "s-1" }], "hi")).rejects.toThrow("member reviewer: member is working");
    expect(core.submitted).toEqual([]);
  });

  it("fails with the reason when the session leaves core.sessions during its turn", async () => {
    const core = fakeCore([IDLE("s-1")], { vanishOn: "s-1" });
    await expect(relayToMembers(core.ports, [{ id: "reviewer", session: "s-1" }], "hi")).rejects.toThrow("session s-1 is not open");
  });

  it("rejects with the member and the refusal of core when a submit is refused", async () => {
    const core = fakeCore([IDLE("s-1")]);
    core.ports.commands.execute = async () => { throw new Error("core.session.submit text must not contain CR or LF"); };
    await expect(relayToMembers(core.ports, [{ id: "reviewer", session: "s-1" }], "a\nb")).rejects.toThrow(
      "member reviewer: core.session.submit text must not contain CR or LF",
    );
  });
});

const MEMBERS = [{ id: "reviewer", name: "Claude", session: "s-1" }, { id: "writer", name: "Codex", session: "s-2" }];

describe("relayInMode (docs/spec/room.md#modes)", () => {
  it("turn: relays to each member one after another in roster order", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")]);
    const answers = await relayInMode(core.ports, "turn", MEMBERS, "hello");
    expect(core.submitted.map((entry) => entry.session)).toEqual(["s-1", "s-2"]);
    expect(answers.map((answer) => answer.id)).toEqual(["reviewer", "writer"]);
  });

  it("turn: a mention selects only the mentioned members in mention order", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")]);
    await relayInMode(core.ports, "turn", MEMBERS, "@codex first, then @claude");
    expect(core.submitted.map((entry) => entry.session)).toEqual(["s-2", "s-1"]);
  });

  it("facil: relays to the first idle member in roster order only", async () => {
    const core = fakeCore([{ session: "s-1", program: { state: "working" } }, IDLE("s-2")]);
    const answers = await relayInMode(core.ports, "facil", MEMBERS, "who takes this");
    expect(core.submitted).toEqual([{ session: "s-2", text: "who takes this" }]);
    expect(answers.map((answer) => answer.id)).toEqual(["writer"]);
  });

  it("facil: a mention names the member that receives the message", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")]);
    await relayInMode(core.ports, "facil", MEMBERS, "@Codex please");
    expect(core.submitted.map((entry) => entry.session)).toEqual(["s-2"]);
  });

  it("facil: refuses the send when no member is idle", async () => {
    const core = fakeCore([{ session: "s-1", program: { state: "working" } }, { session: "s-2", program: null }]);
    await expect(relayInMode(core.ports, "facil", MEMBERS, "hi")).rejects.toThrow("no member is idle");
    expect(core.submitted).toEqual([]);
  });

  it("simul: submits to every member before any turn ends and keeps roster order in the answers", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")], { manual: true });
    const relay = relayInMode(core.ports, "simul", MEMBERS, "all at once");
    await core.submits(2);
    expect(core.submitted.map((entry) => entry.session)).toEqual(["s-1", "s-2"]);
    core.finish("s-2");
    core.finish("s-1");
    const answers = await relay;
    expect(answers.map((answer) => answer.id)).toEqual(["reviewer", "writer"]);
  });

  it("simul: lets the other turns end and rejects with the first failure in member order", async () => {
    const core = fakeCore([{ session: "s-1", program: { state: "working" } }, IDLE("s-2")]);
    await expect(relayInMode(core.ports, "simul", MEMBERS, "hi")).rejects.toThrow("member reviewer: member is working");
    expect(core.submitted.map((entry) => entry.session)).toEqual(["s-2"]);
  });
});
