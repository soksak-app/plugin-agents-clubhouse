// The view of the conversation (docs/spec/room.md#conversation-view): owner bubbles on the right, member bubbles on the left with a
// stable color by roster order, room lines as centered system lines, reports, claims and releases as notes under the bubble of their
// member, sections as blocks of the bubble, and a divider with the round number before each round of the members.
import { describe, expect, it } from "vitest";
import { conversationView, elapsedLabel, nextLabelChange } from "./bubbles";
import type { StatusEntry } from "./conversation-status";

const entry = (speaker: string, text: string, elapsedMs: number | null = null, sections: StatusEntry["sections"] = []): StatusEntry => ({
  speaker,
  text,
  at: 1000,
  elapsedMs,
  sections,
});

describe("conversationView", () => {
  it("draws owner bubbles on the right, member bubbles on the left with the color of their roster place, and room lines as system lines", () => {
    const view = conversationView([entry("owner", "build it"), entry("b", "plan", 12400), entry("clubhouse", "the conversation settled")], ["a", "b"]);
    expect(view).toEqual([
      { kind: "bubble", index: 0, side: "right", speaker: "owner", color: null, text: "build it", sections: [], elapsedMs: null, notes: [] },
      { kind: "divider", round: 1 },
      { kind: "bubble", index: 1, side: "left", speaker: "b", color: 1, text: "plan", sections: [], elapsedMs: 12400, notes: [] },
      { kind: "system", text: "the conversation settled", index: 2 },
    ]);
  });

  it("draws the reports, claims and releases of a turn as notes under the answer bubble of their member", () => {
    const view = conversationView([entry("owner", "go"), entry("a", "(claim) src/api.ts"), entry("a", "(report) I change the API"), entry("a", "done"), entry("a", "(release) src/api.ts")], ["a"]);
    expect(view.filter((item) => item.kind === "bubble").map((item) => item.kind === "bubble" && item.notes)).toEqual([
      [],
      [{ kind: "claim", text: "src/api.ts" }, { kind: "report", text: "I change the API" }, { kind: "release", text: "src/api.ts" }],
    ]);
    const last = view.at(-1);
    expect(last).toMatchObject({ kind: "bubble", speaker: "a", text: "done", notes: [{ kind: "claim" }, { kind: "report" }, { kind: "release", text: "src/api.ts" }] });
  });

  it("keeps the sections of an answer as the blocks of its bubble", () => {
    const sections = [{ to: "owner", text: "done" }, { to: "b", text: "yes" }];
    expect(conversationView([entry("a", "@owner: done\n@b: yes", 10, sections)], ["a", "b"])).toContainEqual(expect.objectContaining({ kind: "bubble", sections }));
  });

  it("starts a new round with its number when a member speaks again after the owner line", () => {
    const view = conversationView([entry("owner", "go"), entry("a", "1"), entry("b", "2"), entry("a", "3"), entry("owner", "next"), entry("b", "4")], ["a", "b"]);
    expect(view.map((item) => (item.kind === "divider" ? `#${item.round}` : item.kind === "bubble" ? item.text : item.text))).toEqual(["go", "#1", "1", "2", "#2", "3", "next", "#1", "4"]);
  });
});

describe("elapsedLabel", () => {
  it("shows seconds with one decimal", () => {
    expect(elapsedLabel(12400, "ko")).toBe("12.4초");
    expect(elapsedLabel(12400, "en")).toBe("12.4 s");
    expect(elapsedLabel(0, "ko")).toBe("0.0초");
  });
});

// The counter of a waiting member (docs/spec/room.md#timing): the view schedules one callback at the next change of the label, so the
// writes and the callbacks over a wait are as many as the label changes, not as many as the display frames.
describe("nextLabelChange", () => {
  it("schedules each callback at a change of the real elapsedLabel, once per change over a ten-minute wait", () => {
    const span = 10 * 60 * 1000;
    let changes = 0;
    for (let ms = 1; ms <= span; ms += 1) if (elapsedLabel(ms, "ko") !== elapsedLabel(ms - 1, "ko")) changes += 1;
    let callbacks = 0;
    let writes = 0;
    let shown = elapsedLabel(0, "ko");
    for (let ms = 0; ms < span; ) {
      const delay = nextLabelChange(ms);
      expect(delay).toBeGreaterThan(0);
      ms += delay;
      if (ms > span) break;
      callbacks += 1;
      const label = elapsedLabel(ms, "ko");
      expect(elapsedLabel(ms - 1, "ko")).not.toBe(label);
      if (label !== shown) {
        writes += 1;
        shown = label;
      }
    }
    expect(callbacks).toBe(changes);
    expect(writes).toBe(changes);
  });
});
