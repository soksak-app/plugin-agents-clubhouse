// The room protocol (docs/spec/room.md#room-protocol): one line per session, submitted when the session first reports idle, whose turn
// ends before any relayed message; a failure is reported and refuses the member.
import { describe, expect, it } from "vitest";
import { createProtocolInjector, roomProtocolLine } from "./protocol";
import type { RelayPorts } from "./room-relay";
import { createConversationStatus } from "./conversation-status";

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
  // The conversation status of the room is the tracker of the awaited members (docs/spec/room.md#conversation-status).
  const status = createConversationStatus([], value);
  const ports: Omit<RelayPorts, "answers"> = {
    waiting: status.waiting,
    commands: {
      execute: async (name, params) => {
        if (name !== "core.session.submit") throw new Error(`unexpected command ${name}`);
        submitted.push({ session: params.session as string, text: params.text as string });
        set(params.session as string, "working");
        queueMicrotask(() => set(params.session as string, "idle"));
        return {};
      },
    },
    surface: "room-1",
    sessions: value,
    watchSessions: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  // Ends the session: core.sessions no longer lists it.
  const end = (session: string) => {
    const { [session]: _ended, ...rest } = states;
    states = rest;
    for (const listener of [...listeners]) listener(value());
  };
  return { ports, submitted, set, end, status };
}

const claude = { id: "reviewer", name: "Claude", session: "s-1" };

describe("roomProtocolLine", () => {
  it("is one line with the speaker labels, the mention rule, the turn rule and the other members", () => {
    const line = roomProtocolLine("Claude", ["Codex", "Tester"], "room-1");
    expect(line).not.toMatch(/[\r\n]/);
    for (const part of ["[@owner]", "[@<member>]", "[@clubhouse]", "@<name>", "[@Claude]", "Codex, Tester", "quoted data"]) {
      expect(line).toContain(part);
    }
  });

  it("states the answer command with the room surface, the turn token, the MCP form and the shell form (docs/spec/room.md#answer)", () => {
    const line = roomProtocolLine("Claude", [], "room-1");
    for (const part of [
      "[@clubhouse] turn <token>",
      'command_run with name soksak-plugin-agents-clubhouse.answer, surface room-1 and params {"turn": "<token>", "text": "<your answer>"}',
      "sok soksak-plugin-agents-clubhouse.answer --surface room-1 --turn <token> --text=\"$(cat <<'EOF'",
      "This protocol line takes no answer.",
    ]) {
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
    expect(await Promise.all([first, second])).toEqual([{ ok: true }, { ok: true }]);
    expect(core.submitted).toEqual([{ session: "s-1", text: roomProtocolLine("Claude", ["Codex"], "room-1") }]);
    await injector.ensure(claude, ["Codex"]);
    expect(core.submitted.length).toBe(1);
    expect(reports).toEqual([]);
  });

  it("reports a failed protocol turn and resolves with the refusal of the member", async () => {
    const core = fakeCore({ "s-1": "idle" });
    core.ports.commands.execute = async () => { throw new Error("core.session.submit refused"); };
    const reports: string[] = [];
    const injector = createProtocolInjector(core.ports, (where, text) => void reports.push(`${where}: ${text}`));
    expect(await injector.ensure(claude, [])).toEqual({ ok: false, reason: "member reviewer: core.session.submit refused" });
    expect(reports).toEqual(["room protocol: member reviewer: core.session.submit refused"]);
  });

  it("ends without an error when the session ends before its protocol turn, and teaches the session that replaces it", async () => {
    const core = fakeCore({ "s-1": null });
    const reports: string[] = [];
    const injector = createProtocolInjector(core.ports, (where, text) => void reports.push(`${where}: ${text}`));
    const stale = injector.ensure(claude, []);
    core.end("s-1");
    expect(await stale).toEqual({ ok: false, reason: "member reviewer: session s-1 ended before its protocol turn" });
    core.set("s-2", "idle");
    expect(await injector.ensure({ ...claude, session: "s-2" }, [])).toEqual({ ok: true });
    expect(core.submitted.map((entry) => entry.session)).toEqual(["s-2"]);
    expect(reports).toEqual([]);
  });

  it("ends without an error when the session ends during its protocol turn", async () => {
    const core = fakeCore({ "s-1": "idle" });
    core.ports.commands.execute = async (_name, params) => {
      core.submitted.push({ session: params.session as string, text: params.text as string });
      core.set("s-1", "working");
      core.end("s-1");
      return {};
    };
    const reports: string[] = [];
    const injector = createProtocolInjector(core.ports, (where, text) => void reports.push(`${where}: ${text}`));
    expect(await injector.ensure(claude, [])).toEqual({ ok: false, reason: "member reviewer: session s-1 ended before its protocol turn" });
    expect(reports).toEqual([]);
  });
});

describe("createProtocolInjector waiting (docs/spec/room.md#conversation-status)", () => {
  it("names the member as waiting at the protocol step while its program is blocked before its first idle, and not after its turn", async () => {
    const core = fakeCore({ "s-1": "blocked" });
    const injector = createProtocolInjector(core.ports, () => undefined);
    const turn = injector.ensure(claude, []);
    expect(core.status.read().waiting).toEqual([{ member: "reviewer", session: "s-1", step: "protocol", program: "blocked" }]);
    core.set("s-1", "idle");
    expect(await turn).toEqual({ ok: true });
    expect(core.status.read().waiting).toEqual([]);
  });

  it("ends the wait when the session ends before its protocol turn", async () => {
    const core = fakeCore({ "s-1": null });
    const injector = createProtocolInjector(core.ports, () => undefined);
    const turn = injector.ensure(claude, []);
    expect(core.status.read().waiting).toEqual([{ member: "reviewer", session: "s-1", step: "protocol", program: null }]);
    core.end("s-1");
    await turn;
    expect(core.status.read().waiting).toEqual([]);
  });
});

describe("createProtocolInjector after a restart (docs/spec/room.md#restart)", () => {
  it("submits no protocol line to a session that received it before, and names each session that receives it", async () => {
    const core = fakeCore({ "s-1": "idle", "s-2": "idle" });
    const taught: string[] = [];
    const injector = createProtocolInjector(core.ports, () => undefined, { taught: ["s-1"], onTaught: (session) => taught.push(session) });
    expect(await injector.ensure(claude, [])).toEqual({ ok: true });
    expect(await injector.ensure({ ...claude, session: "s-2" }, [])).toEqual({ ok: true });
    expect(core.submitted.map((entry) => entry.session)).toEqual(["s-2"]);
    expect(taught).toEqual(["s-2"]);
  });
});
