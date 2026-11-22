// @vitest-environment jsdom
// The control tower button runs a declared command (C36, docs/spec/room.md#commands): tower.set {open} opens and closes the
// modal, and the button follows the open state; the button holds no click handler of its own.
import { describe, expect, it } from "vitest";
import { setupTower } from "./header";
import { createRoomCommands } from "../room/commands";
import type { RoomPort } from "../room/port";

const P = "soksak-plugin-agents-clubhouse";

function tower() {
  const room: RoomPort = {
    commands: { execute: async () => null },
    declaredCommands: () => [],
    live: { on: () => ({ dispose() {} }), emit() {} },
    onTheme: () => ({ dispose() {} }),
    report: (where, text) => {
      throw new Error(`${where}: ${text}`);
    },
  };
  const button = document.createElement("button");
  document.body.append(button);
  const handle = setupTower(room, button, "AI 명령", () => "ko");
  const commands = createRoomCommands({
    tower: handle,
    trace: undefined,
    mode: () => "facil",
    state: () => ({ mode: "facil", roster: [], transport: { state: "unavailable", notIsolated: [] } }),
  });
  return { button, handle, set: commands[`${P}.tower.set`] };
}

describe("tower.set", () => {
  it("opens and closes the modal and answers with the state", async () => {
    const t = tower();
    expect(await t.set({ open: true })).toEqual({ open: true });
    expect(t.handle.isOpen()).toBe(true);
    expect(t.button.getAttribute("aria-pressed")).toBe("true");
    expect(await t.set({ open: true })).toEqual({ open: true });
    expect(t.handle.isOpen()).toBe(true);
    expect(await t.set({ open: false })).toEqual({ open: false });
    expect(t.handle.isOpen()).toBe(false);
    expect(t.button.getAttribute("aria-pressed")).toBe("false");
    t.handle.dispose();
  });

  it("refuses an open that is not a boolean", async () => {
    const t = tower();
    await expect(t.set({ open: "yes" })).rejects.toThrow('open must be a boolean, got "yes"');
    t.handle.dispose();
  });

  it("leaves the click to the binding of the declared command", () => {
    const t = tower();
    t.button.click();
    expect(t.handle.isOpen()).toBe(false);
    t.handle.dispose();
  });
});
