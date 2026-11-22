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
  const status = createConversationStatus([], value, () => []);
  const ports: Omit<RelayPorts, "answers" | "lines"> = {
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
    for (const part of ["[@owner]", "[@<member>]", "[@clubhouse]", "@<name>", "@Claude", "Codex, Tester", "quoted data"]) {
      expect(line).toContain(part);
    }
  });

  it("states that a mention passes the next turn to the mentioned member (docs/spec/room.md#conversation)", () => {
    expect(roomProtocolLine("Claude", [], "room-1")).toContain("A mention @<name> gives that member the next turn; mention a member only when you want it to answer.");
  });

  it("states that the turn line holds every unseen record line and that only the answer ends the turn (docs/spec/room.md#conversation-first)", () => {
    const line = roomProtocolLine("Claude", ["Codex"], "room-1");
    expect(line).toContain("Your turn line holds every record line you have not seen; only your answer ends the turn, and each token takes one answer.");
    expect(line).not.toContain("record.ack");
    expect(line).not.toContain("답하지 말고");
  });

  it("states the answer command with the room surface and the turn token, the shell form first (docs/spec/room.md#answer)", () => {
    const line = roomProtocolLine("Claude", [], "room-1");
    const shell = line.indexOf("sok soksak-plugin-agents-clubhouse.answer --surface room-1 --turn <token> --status <continue or settled> --text=\"$(cat <<'EOF'");
    const mcp = line.indexOf('command_run with name soksak-plugin-agents-clubhouse.answer, surface room-1 and params {"turn": "<token>", "status": "continue or settled", "text": "<your answer>"}');
    expect(shell).toBeGreaterThan(0);
    expect(mcp).toBeGreaterThan(shell);
    expect(line).toContain("This protocol line takes no answer.");
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

  it("ends without an error when the session ends before its protocol turn", async () => {
    const core = fakeCore({ "s-1": "working" });
    const reports: string[] = [];
    const injector = createProtocolInjector(core.ports, (where, text) => void reports.push(`${where}: ${text}`));
    const outcome = injector.ensure(claude, []);
    core.end("s-1");
    expect(await outcome).toEqual({ ok: false, reason: "member reviewer: session s-1 ended before its protocol turn" });
    expect(reports).toEqual([]);
  });

  it("ends the protocol turn when core accepts the submit, while the program still works on it (docs/spec/room.md#turn-end)", async () => {
    const core = fakeCore({ "s-1": "idle" });
    core.ports.commands.execute = async (_name, params) => {
      core.submitted.push({ session: params.session as string, text: params.text as string });
      core.set("s-1", "working");
      return {};
    };
    const injector = createProtocolInjector(core.ports, () => {});
    expect(await injector.ensure(claude, [])).toEqual({ ok: true });
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

// Nothing said outside the room (docs/spec/room.md#room-protocol): the room cannot read the terminal text of a member, so the protocol
// line and each turn line tell the member to say everything through the room.
describe("nothing said outside the room", () => {
  it("the protocol line states the rules in short imperative sentences", () => {
    const line = roomProtocolLine("Claude", ["Codex"], "room-1");
    expect(line).toContain("The room cannot read your terminal: say everything through the room, in your answer or with a report or a claim.");
    expect(line).toContain("Put a message to the owner in your answer as a section @owner:.");
    expect(line).toContain("Do not narrate what you are about to do, and do not confirm that you sent the answer.");
    expect(line).toContain("Respond to what the speakers said");
    // The bound holds the line near its size after the rules of the soksak skill, the browser tab and the owner instruction were added
    // (docs/spec/room.md#soksak-knowledge); the earlier bound of 3000 characters held only the rules before them, and the line is the only
    // carrier of these rules because no launch argument carries the skill.
    expect(line.length).toBeLessThan(3500);
  });
});

describe("the work rules of the protocol (docs/spec/room.md#room-protocol)", () => {
  it("states the subagent rule, the empty terminal rule without a closing word and the claim rule of every turn", () => {
    const line = roomProtocolLine("Claude", [], "room-1");
    expect(line).toContain("Split development work of a turn into independent parts and delegate them to subagents with the Agent tool, run them in parallel and verify their results before you report; edit a trivial single file directly.");
    expect(line).toContain("Write nothing in your terminal, no closing word either: end a turn with no text. Never write a state word such as Waiting, Settled, Ready, Done, Sent or Noted; state lives only in the answer status and the session state.");
    expect(line).not.toContain("one word");
    expect(line).toContain("A claim ends with its turn: claim each file in the turn in which you write it, before you write it, and release it when you are done.");
    expect(line).toContain('"paths": ["<path>"]');
  });
});

describe("the room commands run alone (docs/spec/room.md#room-protocol)", () => {
  it("states that each room command runs alone in the foreground and that a timed-out command is reported, not claimed as sent", () => {
    const line = roomProtocolLine("Claude", [], "room-1");
    expect(line).toContain("Run each room command (answer, report, claim, release) as a command of its own in the foreground, never chained with ;, && or |.");
    expect(line).toContain("When a room command times out or goes to the background, report it with report and never say that it was sent.");
  });
});

// The soksak knowledge of a member (docs/spec/room.md#soksak-knowledge): the isolation removes the personal settings of the person,
// and with them the user-scope soksak skill, so the protocol line gives the member the skill and the rule of the browser tab.
describe("soksak knowledge", () => {
  it("the protocol line tells the member to read the soksak skill and to check web pages in a soksak browser tab", () => {
    for (const mcp of [true, false]) {
      const line = roomProtocolLine("Claude", ["Codex"], "room-1", "", mcp);
      expect(line).toContain("First run sok skill print once and follow it: it is the skill of soksak, which runs this room.");
      expect(line).toContain("Check a web page or local server in a soksak browser tab first (core.layout.open with plugin browser, then browser.navigate {url});");
      expect(line).toContain("use another browser only when no browser plugin is installed, and report which case applied.");
      expect(line.length).toBeLessThan(3500);
    }
  });
  it("the protocol line tells how to read an injected owner instruction", () => {
    expect(roomProtocolLine("Claude", ["Codex"], "room-1")).toContain("A line starting [@clubhouse] 방장의 새 지시야. is an owner instruction during your work: apply it, and answer it in your next answer.");
  });
});

