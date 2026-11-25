// Checks that the invite page takes its colors from the theme of the window (core docs/spec/native-surfaces.md, Theme): the view bridge
// sets the theme tokens --card, --fg, --muted, --edge and --fail on the root, and the page that chose its colors from the color scheme of
// the system drew the text of a light system on the dark card of a dark window.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ui/invite.html", () => {
  it("takes its colors from the theme of the window", () => {
    const html = readFileSync(new URL("../ui/invite.html", import.meta.url), "utf8");
    expect(html).not.toMatch(/prefers-color-scheme|data-theme/);
    expect(html).not.toMatch(/--(text|muted|line|error|card)\s*:\s*#/);
    expect(html).toMatch(/--text: var\(--fg\); --line: var\(--edge\); --error: var\(--fail\);/);
  });
});
