// The question of a blocked member (docs/spec/room.md#questions) against the declared owner commands of core
// (core docs/spec/plugins.md#owned-sessions): core.session.read {session} answers {from, rows, cursor}, and core.layout.select {tab}
// makes the tab that shows the session active. The port double answers with those shapes; no module is mocked.
import { describe, expect, it, vi } from "vitest";
import { answerQuestion, questionChoices, questionRows, readQuestion, showMember } from "./question";

function port(reply: (name: string, params: Record<string, unknown>) => unknown) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const execute = vi.fn(async (name: string, params: Record<string, unknown>) => {
    calls.push([name, params]);
    return reply(name, params);
  });
  return { calls, port: { commands: { execute } } };
}

const TRUST = [
  "────────────────",
  " Accessing workspace:",
  "",
  " /tmp/project",
  "",
  " ❯ No, exit",
  "   Yes, I trust this folder",
  "",
  " Enter to confirm · Esc to cancel",
  "",
  "",
];

describe("questionRows", () => {
  it("keeps the rows of the screen from the first to the last row with text, with the trailing spaces of each row removed", () => {
    expect(questionRows(["", "  ", " a  ", "", "b ", "", " "])).toEqual([" a", "", "b"]);
  });

  it("is empty for a screen without text", () => {
    expect(questionRows(["", "   "])).toEqual([]);
  });
});

describe("readQuestion", () => {
  it("reads the screen of the session with core.session.read and returns its rows with text", async () => {
    const { calls, port: p } = port(() => ({ from: 0, rows: TRUST, cursor: { row: 5, column: 1 } }));
    expect(await readQuestion(p, "s-1")).toEqual(TRUST.slice(0, 9));
    expect(calls).toEqual([["core.session.read", { session: "s-1" }]]);
  });

  it("refuses a reply whose rows are not a list of texts", async () => {
    const { port: p } = port(() => ({ from: 0, rows: [1], cursor: { row: 0, column: 0 } }));
    await expect(readQuestion(p, "s-1")).rejects.toThrow("core.session.read rows of s-1 are not a list of texts");
  });
});

describe("showMember", () => {
  const sessions = [
    { session: "s-1", plugin: "terminal", owner: "room", shownBy: "tab-a", program: { state: "blocked" } },
    { session: "s-2", plugin: "terminal", owner: "room", shownBy: null, program: null },
  ];

  it("makes the tab that shows the session of the member active with core.layout.select", async () => {
    const { calls, port: p } = port(() => ({}));
    expect(await showMember(p, sessions, "lead", "s-1")).toEqual({ member: "lead", tab: "tab-a" });
    expect(calls).toEqual([["core.layout.select", { tab: "tab-a" }]]);
  });

  it("refuses a member whose session no tab shows, and selects nothing", async () => {
    const { calls, port: p } = port(() => ({}));
    await expect(showMember(p, sessions, "dev", "s-2")).rejects.toThrow("member dev: no tab shows its session s-2");
    expect(calls).toEqual([]);
  });
});

// C112 (docs/spec/room.md#questions): the choices of a question and the keys that select one.
const PERMISSION = [
  " Bash command",
  "",
  "   rm -rf build",
  "",
  " Do you want to proceed?",
  " ❯ 1. Yes",
  "   2. Yes, and don't ask again for rm commands in /tmp/project",
  "   3. No, and tell Claude what to do differently (esc)",
  "",
];
const CODEX = [
  "  Would you like to run the following command?",
  "",
  "  $ git push",
  "",
  "› 1. Yes, proceed (y)",
  "  2. Yes, and don't ask again for this command (a)",
  "  3. No, and tell Codex what to do differently (esc)",
];

describe("questionChoices", () => {
  it("lists the options around the cursor that share its indentation, the cursor first marked", () => {
    expect(questionChoices(questionRows(TRUST))).toEqual([
      { index: 0, text: "No, exit", current: true },
      { index: 1, text: "Yes, I trust this folder", current: false },
    ]);
    expect(questionChoices(PERMISSION).map((one) => one.text)).toEqual([
      "1. Yes",
      "2. Yes, and don't ask again for rm commands in /tmp/project",
      "3. No, and tell Claude what to do differently (esc)",
    ]);
    expect(questionChoices(CODEX).map((one) => [one.index, one.current])).toEqual([[0, true], [1, false], [2, false]]);
  });

  it("finds no choices on a screen without a cursor row", () => {
    expect(questionChoices(["Press any key", "to continue"])).toEqual([]);
  });
});

describe("answerQuestion", () => {
  it("reads the screen again, moves the cursor to the choice with arrow keys and confirms with Enter", async () => {
    const { calls, port: p } = port((name) => (name === "core.session.read" ? { from: 0, rows: TRUST, cursor: null } : {}));
    expect(await answerQuestion(p, "dev-1", "s-1", "Yes, I trust this folder")).toEqual({ member: "dev-1", choice: "Yes, I trust this folder" });
    expect(calls).toEqual([
      ["core.session.read", { session: "s-1" }],
      ["core.session.input", { session: "s-1", text: "\u001b[B\r" }],
    ]);
  });

  it("moves up from a cursor below the choice", async () => {
    const { calls, port: p } = port((name) => (name === "core.session.read" ? { from: 0, rows: ["   b", "   c", " ❯ d"], cursor: null } : {}));
    await answerQuestion(p, "dev-1", "s-1", "b");
    expect(calls[1]).toEqual(["core.session.input", { session: "s-1", text: "\u001b[A\u001b[A\r" }]);
  });

  it("refuses a choice that the screen no longer shows and types nothing", async () => {
    const { calls, port: p } = port((name) => (name === "core.session.read" ? { from: 0, rows: ["done"], cursor: null } : {}));
    await expect(answerQuestion(p, "dev-1", "s-1", "Yes, I trust this folder")).rejects.toThrow(
      "member dev-1: the question of session s-1 no longer shows the choice Yes, I trust this folder",
    );
    expect(calls.map(([name]) => name)).toEqual(["core.session.read"]);
  });
});
