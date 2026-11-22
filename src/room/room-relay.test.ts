// The message relay of the room (C5) over the members' owned sessions: each room message is submitted to each member in roster order,
// the next member starts after the previous turn has ended, and the screen of each member is read as its answer. The room port double
// answers with the declared shapes and moves a session through idle, working and idle as core would.
import { describe, expect, it } from "vitest";
import { relayToMembers, type RelayPorts } from "./room-relay";

interface FakeSession { session: string; program: { state: "idle" | "working" | "blocked" } | null }

function fakeCore(initial: FakeSession[], options: { stuckOn?: string; vanishOn?: string } = {}) {
  let sessions: FakeSession[] = initial.map((entry) => ({ ...entry }));
  const listeners = new Set<(value: unknown) => void>();
  const submitted: { session: string; text: string }[] = [];
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
          const session = params.session as string;
          setState(session, "working");
          if (options.vanishOn === session) {
            sessions = sessions.filter((entry) => entry.session !== session);
            publish();
          } else if (options.stuckOn !== session) {
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
  return { ports, submitted };
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
