// The message relay of the room (C5) over the members' owned sessions: each room message is submitted to each member in roster order,
// the next member starts after the previous turn has ended, and the screen of each member is read as its answer. The room port double
// answers with the declared shapes and moves a session through idle, working and idle as core would.
import { describe, expect, it } from "vitest";
import { relayInMode, relayToMembers, type RelayPorts } from "./room-relay";
import fixture from "./fixtures/member-screens.json";

interface FakeSession { session: string; program: { state: "idle" | "working" | "blocked" } | null }

function fakeCore(
  initial: FakeSession[],
  options: { stuckOn?: string; vanishOn?: string; manual?: boolean; replies?: Record<string, string[]>; height?: number } = {},
) {
  let sessions: FakeSession[] = initial.map((entry) => ({ ...entry }));
  const listeners = new Set<(value: unknown) => void>();
  const submitted: { session: string; text: string }[] = [];
  const reads: { session: string; from?: number; count?: number }[] = [];
  const waiters: { count: number; resolve: () => void }[] = [];
  // The retained rows of each session by absolute line number: the program echoes a submitted line after its prompt marker and
  // writes its reply rows and its next prompt when its turn ends.
  const lines = new Map<string, string[]>(initial.map((entry) => [entry.session, ["❯"]]));
  const height = options.height ?? 40;
  // Resolves when the given number of lines has been submitted, so a test reads the submits of parallel turns without a timer.
  const submits = (count: number) => new Promise<void>((resolve) => (submitted.length >= count ? resolve() : waiters.push({ count, resolve })));
  const publish = () => { for (const listener of [...listeners]) listener(sessions.map((entry) => ({ ...entry }))); };
  const setState = (session: string, state: "idle" | "working" | "blocked") => {
    sessions = sessions.map((entry) => (entry.session === session ? { ...entry, program: { state } } : entry));
    publish();
  };
  const finish = (session: string) => {
    lines.get(session)!.push(...(options.replies?.[session] ?? [`⏺ answer of ${session}`, "", "❯"]));
    setState(session, "idle");
  };
  const ports: RelayPorts = {
    commands: {
      execute: async (name, params) => {
        const session = params.session as string;
        if (name === "core.session.submit") {
          submitted.push({ session, text: params.text as string });
          for (const waiter of waiters) if (submitted.length >= waiter.count) waiter.resolve();
          lines.get(session)!.push(`❯ ${params.text as string}`);
          setState(session, "working");
          if (options.vanishOn === session) {
            sessions = sessions.filter((entry) => entry.session !== session);
            publish();
          } else if (options.stuckOn !== session && !options.manual) {
            // The turn ends in the next macrotask, after every microtask of the submit: a program answers after the room has read
            // the screen that shows the submitted line, and the fake core answers each command within microtasks.
            setImmediate(() => finish(session));
          }
          return {};
        }
        if (name === "core.session.read") {
          const all = lines.get(session)!;
          reads.push({ session, from: params.from as number | undefined, count: params.count as number | undefined });
          if (params.from === undefined) {
            const from = Math.max(0, all.length - height);
            return { from, rows: all.slice(from), cursor: { row: 0, column: 0 } };
          }
          const from = params.from as number;
          const count = params.count as number;
          if (count < 1 || count > 200) throw new Error("core.session.read count must be an integer from 1 to 200");
          if (from + count > all.length) throw new Error(`lines ${from} to ${from + count - 1} are outside the retained rows`);
          return { from, count, rows: all.slice(from, from + count) };
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
  return { ports, submitted, reads, submits, finish };
}

const IDLE = (session: string): FakeSession => ({ session, program: { state: "idle" } });

describe("relayToMembers", () => {
  it("submits the message to each member in order, waits for each turn, and returns the answer of each member", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")]);
    const answers = await relayToMembers(core.ports, [{ id: "reviewer", session: "s-1" }, { id: "writer", session: "s-2" }], "hello");
    expect(core.submitted).toEqual([{ session: "s-1", text: "hello" }, { session: "s-2", text: "hello" }]);
    expect(answers).toEqual([
      { id: "reviewer", text: "answer of s-1" },
      { id: "writer", text: "answer of s-2" },
    ]);
  });

  it("answers the reply rows of the turn only, without the status line, the separators and the prompt", async () => {
    const rows = fixture.screens[0].rows;
    const core = fakeCore([IDLE("s-1")], { replies: { "s-1": rows } });
    const answers = await relayToMembers(core.ports, [{ id: "harness-harness", session: "s-1" }], "hello");
    expect(answers).toEqual([
      { id: "harness-harness", text: "여러분들, 저는 harness고 코드 변경을 꼼꼼히 확인하고\n커밋하는 일을 잘하는데요, 아직 앞에서 말한 사람이\n없어서 덧붙일 말은 없어요." },
    ]);
  });

  it("rejects with the member when the reply rows of its turn are broken", async () => {
    const core = fakeCore([IDLE("s-1")], { replies: { "s-1": fixture.screens[1].rows } });
    await expect(relayToMembers(core.ports, [{ id: "moai-manager-lead", session: "s-1" }], "hello")).rejects.toThrow(
      'member moai-manager-lead: the reply rows are broken at turn row 1: "보고"',
    );
  });

  it("answers a reply taller than the screen, read from the submitted line in pages of at most 200 rows", async () => {
    const body = Array.from({ length: 450 }, (_, index) => `  row ${index + 1}`);
    const core = fakeCore([IDLE("s-1")], { height: 5, replies: { "s-1": ["⏺ row 0", ...body, "", "✻ Baked for 9s", "─────", "❯", "─────"] } });
    const answers = await relayToMembers(core.ports, [{ id: "harness-harness", session: "s-1" }], "hello");
    expect(answers).toEqual([{ id: "harness-harness", text: ["row 0", ...body.map((row) => row.slice(2))].join("\n") }]);
    // Line 0 is the first prompt and line 1 the submitted line; the turn rows are lines 2 to 457.
    expect(core.reads.filter((read) => read.from !== undefined)).toEqual([
      { session: "s-1", from: 2, count: 200 },
      { session: "s-1", from: 202, count: 200 },
      { session: "s-1", from: 402, count: 56 },
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
  it("turn: relays to each member one after another in roster order, labeled with the owner, with the earlier answers", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")]);
    const answers = await relayInMode(core.ports, "turn", MEMBERS, "hello");
    expect(core.submitted).toEqual([
      { session: "s-1", text: "[@owner] hello" },
      { session: "s-2", text: "[@owner] hello | [@Claude] answer of s-1" },
    ]);
    expect(answers.map((answer) => answer.id)).toEqual(["reviewer", "writer"]);
  });

  it("turn: a mention selects only the mentioned members in mention order", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")]);
    await relayInMode(core.ports, "turn", MEMBERS, "@codex first, then @claude");
    expect(core.submitted).toEqual([
      { session: "s-2", text: "[@owner] @codex first, then @claude" },
      { session: "s-1", text: "[@owner] @codex first, then @claude | [@Codex] answer of s-2" },
    ]);
  });

  it("turn: an earlier answer of several rows reaches the next member as one line", async () => {
    const core = fakeCore([IDLE("s-1"), IDLE("s-2")], { replies: { "s-1": ["⏺ one", "  two", "", "❯"] } });
    await relayInMode(core.ports, "turn", MEMBERS, "hello");
    expect(core.submitted[1]).toEqual({ session: "s-2", text: "[@owner] hello | [@Claude] one two" });
  });

  it("facil: relays to the first idle member in roster order only", async () => {
    const core = fakeCore([{ session: "s-1", program: { state: "working" } }, IDLE("s-2")]);
    const answers = await relayInMode(core.ports, "facil", MEMBERS, "who takes this");
    expect(core.submitted).toEqual([{ session: "s-2", text: "[@owner] who takes this" }]);
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
    expect(core.submitted.map((entry) => entry.text)).toEqual(["[@owner] all at once", "[@owner] all at once"]);
  });

  it("simul: lets the other turns end and rejects with the first failure in member order", async () => {
    const core = fakeCore([{ session: "s-1", program: { state: "working" } }, IDLE("s-2")]);
    await expect(relayInMode(core.ports, "simul", MEMBERS, "hi")).rejects.toThrow("member reviewer: member is working");
    expect(core.submitted.map((entry) => entry.session)).toEqual(["s-2"]);
  });
});
