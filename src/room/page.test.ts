// The page start of the room view (core docs/spec/plugins.md#view-surfaces): the page reads its settings and project data
// through the view context, then registers the commands, elements and statuses that plugin.json declares.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startRoomPage } from "./page";

const manifest = JSON.parse(readFileSync(join(process.cwd(), "plugin.json"), "utf8")) as {
  exposes: { commands: { name: string }[]; element: { name: string }[]; status: { name: string }[] };
  data: Record<string, unknown>;
};

function fakeData() {
  const calls: [string, string][] = [];
  return {
    calls,
    get: async (key: string) => {
      calls.push(["get", key]);
      return [];
    },
    set: async (key: string) => void calls.push(["set", key]),
    change: async (key: string, next: (value: unknown) => unknown) => {
      calls.push(["change", key]);
      return next([]);
    },
  };
}

function fakeExpose() {
  const calls: [string, string][] = [];
  return {
    calls,
    command: async (name: string) => void calls.push(["command", name]),
    element: async (name: string) => void calls.push(["element", name]),
    status: async (name: string) => void calls.push(["status", name]),
  };
}

function fakeCommands() {
  const names: string[] = [];
  return {
    names,
    register: (name: string) => {
      names.push(name);
      return Promise.resolve();
    },
  };
}

// The names that the room page registers: every declared entry.
const room = (items: { name: string }[]) => items.map((item) => item.name).sort();

function buildRoom() {
  const commands: Record<string, () => unknown> = {};
  for (const c of manifest.exposes.commands) commands[c.name] = () => ({ ok: true });
  const elements: Record<string, object> = {};
  for (const e of manifest.exposes.element) elements[e.name] = { dataset: {} };
  const statuses: Record<string, { read: () => unknown; subscribe: () => () => void }> = {};
  for (const s of manifest.exposes.status) statuses[s.name] = { read: () => null, subscribe: () => () => {} };
  return { commands, elements, statuses };
}

describe("startRoomPage", () => {
  it("reads the settings and the project data context, then registers the exposure of plugin.json", async () => {
    const data = fakeData();
    const expose = fakeExpose();
    const commands = fakeCommands();
    let seenSettings: unknown = null;
    const page = await startRoomPage(
      {
        manifest,
        settings: async () => ({ conversationTurns: 48 }),
        data,
        expose,
        commands,
      },
      (context) => {
        seenSettings = context.settings;
        // The collections write through the project data of the view, so each store reaches a declared key.
        expect(typeof context.collections.put).toBe("function");
        expect(typeof context.collections.query).toBe("function");
        return buildRoom();
      },
    );
    expect(seenSettings).toEqual({ conversationTurns: 48 });
    expect(page).toBeDefined();
    expect(expose.calls.filter((c) => c[0] === "command").map((c) => c[1]).sort()).toEqual(
      room(manifest.exposes.commands),
    );
    expect(expose.calls.filter((c) => c[0] === "element").map((c) => c[1]).sort()).toEqual(
      room(manifest.exposes.element),
    );
    expect(expose.calls.filter((c) => c[0] === "status").map((c) => c[1]).sort()).toEqual(
      manifest.exposes.status.map((s) => s.name).sort(),
    );
    expect(commands.names.sort()).toEqual(room(manifest.exposes.commands));
  });

  it("does not register the exposure when the room cannot be built", async () => {
    const expose = fakeExpose();
    await expect(
      startRoomPage(
        { manifest, settings: async () => ({}), data: fakeData(), expose, commands: fakeCommands() },
        () => {
          throw new Error("room build failed");
        },
      ),
    ).rejects.toThrow("room build failed");
    expect(expose.calls).toEqual([]);
  });

  it("declares a project data key for every store the page creates", () => {
    expect(Object.keys(manifest.data).sort()).toEqual(["member-sessions"]);
  });
});
