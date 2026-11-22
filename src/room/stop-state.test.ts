// @vitest-environment jsdom
// The stop button is enabled only while a relay runs or a kept token is open, and a disabled button is drawn as disabled
// (docs/spec/room.md#commands).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createStopState } from "./stop-state";

describe("createStopState", () => {
  it("disables the button when no relay runs and no kept token is open, and enables it while one is", () => {
    const button = document.createElement("button");
    let changes = 0;
    const stop = createStopState(button, () => void (changes += 1));
    stop.update(false, false);
    expect(button.disabled).toBe(true);
    expect(stop.enabled()).toBe(false);
    stop.update(true, false);
    expect(button.disabled).toBe(false);
    stop.update(false, true);
    expect(stop.enabled()).toBe(true);
    stop.update(false, false);
    expect(button.disabled).toBe(true);
    expect(changes).toBe(3);
  });

  it("draws a disabled composer button differently from an enabled one", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "main.ts"), "utf8");
    expect(css).toMatch(/\.st-in button:disabled\{[^}]*opacity:/);
  });
});
