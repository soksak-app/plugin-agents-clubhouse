// The question of a blocked member (docs/spec/room.md#questions) against the declared owner commands of core
// (core docs/spec/plugins.md#owned-sessions): core.session.read {session} answers {from, rows, cursor}, and core.layout.select {tab}
// makes the tab that shows the session active. The port double answers with those shapes; no module is mocked.
import { describe, expect, it, vi } from "vitest";
import { questionRows, readQuestion, showMember } from "./question";

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
