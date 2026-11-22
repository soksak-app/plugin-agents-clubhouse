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
  const ports: Omit<RelayPorts, "answers" | "lines" | "persisted"> = {
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
    const line = roomProtocolLine("Claude", "room-1");
    expect(line).not.toMatch(/[\r\n]/);
    for (const part of ["[@owner]", "[@<member>]", "[@clubhouse]", "@<name>", "@Claude", "Members, roles and team: sok status", "quoted data"]) {
      expect(line).toContain(part);
    }
  });

  it("states that a mention passes the next turn to the mentioned member (docs/spec/room.md#conversation)", () => {
    expect(roomProtocolLine("Claude", "room-1")).toContain("A mention @<name> gives that member the next turn; mention only to get an answer.");
  });

  it("states that the turn line holds every unseen record line and that only the answer ends the turn (docs/spec/room.md#conversation-first)", () => {
    const line = roomProtocolLine("Claude", "room-1");
    expect(line).toContain("A line ending [@clubhouse] turn <token> is your turn; it holds every record line you have not seen, and only your answer ends it, one answer per token.");
    expect(line).not.toContain("record.ack");
    expect(line).not.toContain("답하지 말고");
  });

  it("states the answer command with the room surface and the turn token, the shell form first (docs/spec/room.md#answer)", () => {
    const line = roomProtocolLine("Claude", "room-1");
    const shell = line.indexOf("sok soksak-plugin-agents-clubhouse.answer --surface room-1 --turn <token> --status <continue|settled> --text=\"$(cat <<'EOF' <text> EOF)\"");
    const mcp = line.indexOf('MCP command_run {name: soksak-plugin-agents-clubhouse.answer, surface: room-1, params: {turn, status, text}}');
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
    const first = injector.ensure(claude);
    const second = injector.ensure(claude);
    expect(core.submitted).toEqual([]);
    core.set("s-1", "idle");
    expect(await Promise.all([first, second])).toEqual([{ ok: true }, { ok: true }]);
    expect(core.submitted).toEqual([{ session: "s-1", text: roomProtocolLine("Claude", "room-1") }]);
    await injector.ensure(claude);
    expect(core.submitted.length).toBe(1);
    expect(reports).toEqual([]);
  });

  it("reports a failed protocol turn and resolves with the refusal of the member", async () => {
    const core = fakeCore({ "s-1": "idle" });
    core.ports.commands.execute = async () => { throw new Error("core.session.submit refused"); };
    const reports: string[] = [];
    const injector = createProtocolInjector(core.ports, (where, text) => void reports.push(`${where}: ${text}`));
    expect(await injector.ensure(claude)).toEqual({ ok: false, reason: "member reviewer: core.session.submit refused" });
    expect(reports).toEqual(["room protocol: member reviewer: core.session.submit refused"]);
  });

  it("ends without an error when the session ends before its protocol turn, and teaches the session that replaces it", async () => {
    const core = fakeCore({ "s-1": null });
    const reports: string[] = [];
    const injector = createProtocolInjector(core.ports, (where, text) => void reports.push(`${where}: ${text}`));
    const stale = injector.ensure(claude);
    core.end("s-1");
    expect(await stale).toEqual({ ok: false, reason: "member reviewer: session s-1 ended before its protocol turn" });
    core.set("s-2", "idle");
    expect(await injector.ensure({ ...claude, session: "s-2" })).toEqual({ ok: true });
    expect(core.submitted.map((entry) => entry.session)).toEqual(["s-2"]);
    expect(reports).toEqual([]);
  });

  it("ends without an error when the session ends before its protocol turn", async () => {
    const core = fakeCore({ "s-1": "working" });
    const reports: string[] = [];
    const injector = createProtocolInjector(core.ports, (where, text) => void reports.push(`${where}: ${text}`));
    const outcome = injector.ensure(claude);
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
    expect(await injector.ensure(claude)).toEqual({ ok: true });
  });
});

describe("createProtocolInjector waiting (docs/spec/room.md#conversation-status)", () => {
  it("names the member as waiting at the protocol step while its program is blocked before its first idle, and not after its turn", async () => {
    const core = fakeCore({ "s-1": "blocked" });
    const injector = createProtocolInjector(core.ports, () => undefined);
    const turn = injector.ensure(claude);
    expect(core.status.read().waiting).toEqual([{ member: "reviewer", session: "s-1", step: "protocol", program: "blocked" }]);
    core.set("s-1", "idle");
    expect(await turn).toEqual({ ok: true });
    expect(core.status.read().waiting).toEqual([]);
  });

  it("ends the wait when the session ends before its protocol turn", async () => {
    const core = fakeCore({ "s-1": null });
    const injector = createProtocolInjector(core.ports, () => undefined);
    const turn = injector.ensure(claude);
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
    expect(await injector.ensure(claude)).toEqual({ ok: true });
    expect(await injector.ensure({ ...claude, session: "s-2" })).toEqual({ ok: true });
    expect(core.submitted.map((entry) => entry.session)).toEqual(["s-2"]);
    expect(taught).toEqual(["s-2"]);
  });
});

// Nothing said outside the room (docs/spec/room.md#room-protocol): the room cannot read the terminal text of a member, so the protocol
// line and each turn line tell the member to say everything through the room.
describe("nothing said outside the room", () => {
  it("the protocol line states the rules in short imperative sentences", () => {
    const line = roomProtocolLine("Claude", "room-1");
    expect(line).toContain("The room cannot read your terminal: say everything in your answer, a report or a claim; write nothing there, not even a closing word.");
    expect(line).toContain("(@owner: the owner, @all: everyone)");
    // C95 (docs/spec/room.md#mentions): `@all` has one meaning, and only the owner and the leader start turns with it.
    expect(line).toContain("@all addresses everyone, and yours starts no turn.");
    expect(line).toContain("Do not narrate plans or confirm a sent answer.");
    expect(line).toContain("Answer each addressed speaker in speaking order, one section per line starting @<name>:");
    // The bound holds the line near its size after the rules of the soksak skill, the browser tab and the owner instruction were added
    // (docs/spec/room.md#soksak-knowledge); the earlier bound of 3000 characters held only the rules before them, and the line is the only
    // carrier of these rules because no launch argument carries the skill.
    expect(line.length).toBeLessThan(3500);
  });
});

describe("the work rules of the protocol (docs/spec/room.md#room-protocol)", () => {
  it("states the subagent rule, the empty terminal rule without a closing word and the claim rule of every turn", () => {
    const line = roomProtocolLine("Claude", "room-1");
    expect(line).toContain("Split development work into independent parts for parallel subagents (Agent tool) and verify their results before reporting; edit a trivial single file directly.");
    expect(line).toContain("Never write a state word (Waiting, Settled, Ready, Done, Sent, Noted); state lives only in the answer status.");
    expect(line).not.toContain("one word");
    expect(line).toContain("Claim each file in the turn you write it, before writing: ");
    expect(line).toContain('A claim ends with its turn; a refusal names the holder to coordinate with.');
  });
});

describe("the room commands run alone (docs/spec/room.md#room-protocol)", () => {
  it("states that each room command runs alone in the foreground and that a timed-out command is reported, not claimed as sent", () => {
    const line = roomProtocolLine("Claude", "room-1");
    expect(line).toContain("and each room command alone in the foreground, never chained with ;, && or |.");
    expect(line).toContain("If one times out or goes to the background, report it and never call it sent.");
    expect(line).toContain("Run every other room command as sok soksak-plugin-agents-clubhouse.<command> --surface room-1 --params '<json>',");
  });
});

// The soksak knowledge of a member (docs/spec/room.md#soksak-knowledge): the isolation removes the personal settings of the person,
// and with them the user-scope soksak skill, so the protocol line gives the member the skill and the rule of the browser tab.
describe("soksak knowledge", () => {
  it("the protocol line tells the member to read the soksak skill and to check web pages in a soksak browser tab", () => {
    for (const mcp of [true, false]) {
      const line = roomProtocolLine("Claude", "room-1", mcp);
      expect(line).toContain("First run sok skill print once and follow it.");
      expect(line).toContain("Check web pages and local servers in a soksak browser tab (core.layout.open plugin browser, then browser.navigate {url}),");
      expect(line).toContain("another browser only without that plugin, and say which applied.");
      expect(line.length).toBeLessThan(3500);
    }
  });
  it("the protocol line tells how to read an injected owner instruction", () => {
    expect(roomProtocolLine("Claude", "room-1")).toContain("A line starting [@clubhouse] 방장의 새 지시야. is an owner instruction: apply it and answer it next.");
  });
});


// The team protocol (docs/spec/room.md#team): the leader line states the summon and the merge, and the worker line the worktree
// lifecycle inside the project, because Claude Code keeps a cd of the shell only inside the folders of the session.
describe("the team protocol", () => {
  it("tells the leader that it leads, how to summon and that its settled answer ends the conversation", () => {
    const line = roomProtocolLine("Lead", "room-1", true, { leader: null });
    expect(line).toContain("You lead: you get every line and split the work; your settled answer ends the conversation.");
    expect(line).toContain('member.summon {"turn":"<token>","definition":"<id>","role":"<role>","directory":"<project>"}');
    expect(line).toContain("Add .worktrees/ to .gitignore if missing.");
    expect(line).toContain("Record a merge with member.merged {turn, member, commit} and end a worker with member.release {turn, member}.");
    expect(line).toContain("workers mentioned in one answer start together.");
    expect(line).toContain("@all addresses everyone, and yours starts every worker.");
    expect(line).toContain("List the agents you can summon with definitions {} and read the file of each before you choose.");
  });

  it("tells a worker the worktree lifecycle inside the project", () => {
    const line = roomProtocolLine("W1", "room-1", true, { leader: "Lead" });
    expect(line).toContain("You work for @Lead and get the owner lines and the lines mentioning you; your brief is your scope.");
    expect(line).toContain("In one Bash call create your worktree and branch, named as you, and cd into it (W=W1; git worktree add -q .worktrees/$W -b $W && cd .worktrees/$W); work there.");
    expect(line).toContain("@all addresses everyone, and yours starts no turn.");
    expect(line).toContain("After it names the merge commit, check your work and unit tests in integration, cd to the project root, remove your worktree, delete your branch, and report it.");
    expect(line).toContain("Leave no background task running when you answer.");
  });

  it("states no team rule without a leader", () => {
    expect(roomProtocolLine("Claude", "room-1")).not.toContain("leader");
  });
});

// A room command that fails, for example while the room page reloads, returns its error to the member (C91): the member runs it again.
describe("a failed room command", () => {
  it("tells the member to run a failed room command again with the same token", () => {
    const line = roomProtocolLine("Claude", "room-1");
    expect(line).toContain("If one fails, rerun it with the same token until it is accepted or refused as not open.");
    expect(line.length).toBeLessThan(3500);
  });
});

describe("the work rules of the team (C90)", () => {
  it("states the work rules of the leader and of a worker", () => {
    const lead = roomProtocolLine("Lead", "room-1", true, { leader: null });
    expect(lead).toContain("Each brief fixes the API contract; workers unit-test and merge integration into their branch before asking for a merge; merge server branches first, then dependents update from integration; name each merge commit.");
    const worker = roomProtocolLine("W1", "room-1", true, { leader: "Lead" });
    expect(worker).toContain("Unit-test thoroughly; before reporting done, merge the latest integration and resolve conflicts, then report the branch ready.");
  });
});

// The bound of every protocol line (C93, docs/spec/room.md#room-protocol): the line is one submit of 3500 characters at most, with the
// MCP form, for the leader, a worker and a member without a leader, with a surface, names, a role and peers of the live form.
describe("the protocol line bound", () => {
  it("holds every line at 3500 characters or less, with and without the MCP form", () => {
    const surface = "tab-2fm4e7";
    // A leader and the six members of the default maxMembers.
    const peers = ["Claude (lead)", "Codex-1 (client)", "Claude-2 (tests)", "Claude-3 (server)", "Codex-2 (docs)", "Claude-4 (review)", "Codex-3 (build)"];
    for (const mcp of [true, false]) {
      const lines = {
        plain: roomProtocolLine("Claude", surface, mcp),
        leader: roomProtocolLine("Claude", surface, mcp, { leader: null }),
        worker: roomProtocolLine("Claude-1", surface, mcp, { leader: "Claude" }),
      };
      for (const [kind, line] of Object.entries(lines)) expect(line.length, `${kind} mcp=${mcp}`).toBeLessThanOrEqual(3500);
    }
  });
});

// The bound at the largest configuration (C93-1): sixteen team members with names of 40 characters and their number and roles of 200
// characters. The line takes neither the peers nor the roles: each turn line states the roles, and the members, their roles and the
// team are a read of the conversation status, so only the names of the member and of its leader vary.
describe("the protocol line bound at the largest configuration", () => {
  it("holds the leader and the worker lines at 3500 characters or less with names of the largest length", () => {
    const name = "N".repeat(40);
    for (const mcp of [true, false]) {
      const leader = roomProtocolLine(name, "tab-2fm4e7", mcp, { leader: null });
      const worker = roomProtocolLine(`${name}-16`, "tab-2fm4e7", mcp, { leader: name });
      expect(leader.length, `leader mcp=${mcp}`).toBeLessThanOrEqual(3500);
      expect(worker.length, `worker mcp=${mcp}`).toBeLessThanOrEqual(3500);
      expect(leader).toContain("Members, roles and team: sok status soksak-plugin-agents-clubhouse.conversation --surface tab-2fm4e7.");
    }
  });
});
