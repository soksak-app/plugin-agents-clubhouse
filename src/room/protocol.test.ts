// The room protocol (docs/spec/room.md#room-protocol): one line per session, submitted when the session first reports idle, whose turn
// ends before any relayed message; a failure is reported and refuses the member.
import { describe, expect, it } from "vitest";
import { createProtocolInjector, roomProtocolLine } from "./protocol";
import type { RelayPorts } from "./room-relay";

type State = "idle" | "working" | "blocked";

function fakeCore(initial: Record<string, State | null>) {
  let states = { ...initial };
  const listeners = new Set<(value: unknown) => void>();
  const submitted: { session: string; text: string }[] = [];
  const value = () => Object.entries(states).map(([session, state]) => ({ session, program: state === null ? null : { state } }));
  const set = (session: string, state: State) => {
    states = { ...states, [session]: state };
    for (const listener of [...listeners]) listener(value());
  };
  const ports: RelayPorts = {
    commands: {
      execute: async (name, params) => {
        if (name !== "core.session.submit") throw new Error(`unexpected command ${name}`);
        submitted.push({ session: params.session as string, text: params.text as string });
        set(params.session as string, "working");
        queueMicrotask(() => set(params.session as string, "idle"));
        return {};
      },
    },
    sessions: value,
    watchSessions: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  return { ports, submitted, set };
}

const claude = { id: "reviewer", name: "Claude", session: "s-1" };

describe("roomProtocolLine", () => {
  it("is one line with the speaker labels, the mention rule, the turn rule and the other members", () => {
    const line = roomProtocolLine("Claude", ["Codex", "Tester"]);
    expect(line).not.toMatch(/[\r\n]/);
    for (const part of ["[@owner]", "[@<member>]", "[@clubhouse]", "@<name>", "[@Claude]", "Codex, Tester", "quoted data"]) {
      expect(line).toContain(part);
    }
  });
});

describe("createProtocolInjector", () => {
  it("waits for the first idle state, submits the line once and resolves after its turn", async () => {
    const core = fakeCore({ "s-1": null });
    const reports: string[] = [];
    const injector = createProtocolInjector(core.ports, (where, text) => void reports.push(`${where}: ${text}`));
    const first = injector.ensure(claude, ["Codex"]);
    const second = injector.ensure(claude, ["Codex"]);
    expect(core.submitted).toEqual([]);
    core.set("s-1", "idle");
    await Promise.all([first, second]);
    expect(core.submitted).toEqual([{ session: "s-1", text: roomProtocolLine("Claude", ["Codex"]) }]);
    await injector.ensure(claude, ["Codex"]);
    expect(core.submitted.length).toBe(1);
    expect(reports).toEqual([]);
  });

  it("reports a failed protocol turn and rejects the member", async () => {
    const core = fakeCore({ "s-1": "idle" });
    core.ports.commands.execute = async () => { throw new Error("core.session.submit refused"); };
    const reports: string[] = [];
    const injector = createProtocolInjector(core.ports, (where, text) => void reports.push(`${where}: ${text}`));
    await expect(injector.ensure(claude, [])).rejects.toThrow("member reviewer: core.session.submit refused");
    expect(reports).toEqual(["room protocol: member reviewer: core.session.submit refused"]);
  });
});
