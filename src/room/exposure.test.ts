// Registration of the room's exposed commands, elements and statuses against plugin.json (core docs/spec/exposure.md).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerExposure } from "./exposure";

const manifest = JSON.parse(readFileSync(join(process.cwd(), "plugin.json"), "utf8")) as {
  exposes: {
    commands: { name: string }[];
    element: { name: string }[];
    status: { name: string }[];
  };
};

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

function handlersFor() {
  const commands: Record<string, (params: unknown) => unknown> = {};
  for (const c of manifest.exposes.commands) commands[c.name] = () => ({ ok: true });
  const elements: Record<string, object> = {};
  for (const e of manifest.exposes.element) elements[e.name] = { dataset: {} };
  const statuses: Record<string, { read: () => unknown; subscribe: () => () => void }> = {};
  for (const s of manifest.exposes.status) statuses[s.name] = { read: () => null, subscribe: () => () => {} };
  return { commands, elements, statuses };
}

const names = (items: { name: string }[]) => items.map((i) => i.name).sort();

describe("registerExposure", () => {
  it("registers each declared command, element and status of plugin.json once", async () => {
    const expose = fakeExpose();
    const commands = fakeCommands();
    await registerExposure(expose, commands, manifest, handlersFor());
    const registered = (kind: string) => expose.calls.filter((c) => c[0] === kind).map((c) => c[1]).sort();
    const room = names;
    expect(registered("command")).toEqual(room(manifest.exposes.commands));
    expect(registered("element")).toEqual(room(manifest.exposes.element));
    expect(registered("status")).toEqual(names(manifest.exposes.status));
    expect([...commands.names].sort()).toEqual(room(manifest.exposes.commands));
  });

  it("refuses a declared command that has no handler", async () => {
    const handlers = handlersFor();
    delete handlers.commands["soksak-plugin-agents-clubhouse.state"];
    await expect(registerExposure(fakeExpose(), fakeCommands(), manifest, handlers)).rejects.toThrow(
      /soksak-plugin-agents-clubhouse\.state has no handler/,
    );
  });

  it("refuses a handler for a name that plugin.json does not declare", async () => {
    const handlers = handlersFor();
    handlers.commands["soksak-plugin-agents-clubhouse.ask"] = () => ({ ok: true });
    await expect(registerExposure(fakeExpose(), fakeCommands(), manifest, handlers)).rejects.toThrow(
      /soksak-plugin-agents-clubhouse\.ask is not declared/,
    );
  });
});

// C144 (docs/spec/room.md#leader): the leader has no power over sessions, so the room declares no team command.
describe("the commands of the leader", () => {
  it("declares none of the team commands", () => {
    const names = manifest.exposes.commands.map((command) => command.name);
    for (const gone of ["member.summon", "definitions", "member.release", "member.merged", "member.retask"]) {
      expect(names).not.toContain(`soksak-plugin-agents-clubhouse.${gone}`);
    }
  });
});
