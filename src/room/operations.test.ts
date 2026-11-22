// The commands of the room operations (C35, docs/spec/room.md#commands): member.set, member.move, mode.set and message.send.
import { describe, expect, it } from "vitest";
import { createRoomOperations, type OperationDeps } from "./operations";
import type { RosterEntry } from "./roster";
import type { RoomMode } from "./commands";

const P = "soksak-plugin-agents-clubhouse";

function room(overrides: Partial<OperationDeps> = {}) {
  const roster: RosterEntry[] = [
    { id: "a", name: "A", checked: false },
    { id: "b", name: "B", checked: true },
    { id: "c", name: "C", checked: false },
  ];
  let mode: RoomMode = "facil";
  const log: string[] = [];
  const deps: OperationDeps = {
    roster,
    mode: () => mode,
    setMode: (next) => {
      mode = next;
    },
    changed: () => void log.push("changed"),
    summon: () => void log.push("summon"),
    openMembers: () => 1,
    accept: (text) => void log.push(`accept ${text}`),
    busy: (value) => void log.push(`busy ${value}`),
    relay: async (text) => [{ id: "b", text: `answer to ${text}` }],
    ...overrides,
  };
  return { roster, log, mode: () => mode, commands: createRoomOperations(deps) };
}

describe("member.set", () => {
  it("checks a member, redraws and summons, and answers with the new state", async () => {
    const r = room();
    expect(await r.commands[`${P}.member.set`]({ id: "a", checked: true })).toEqual({ id: "a", checked: true });
    expect(r.roster[0].checked).toBe(true);
    expect(r.log).toEqual(["changed", "summon"]);
  });

  it("is idempotent: the current state changes nothing and summons nothing", async () => {
    const r = room();
    expect(await r.commands[`${P}.member.set`]({ id: "b", checked: true })).toEqual({ id: "b", checked: true });
    expect(r.log).toEqual([]);
  });

  it("refuses an unknown id and a checked value that is not a boolean", async () => {
    const r = room();
    await expect(r.commands[`${P}.member.set`]({ id: "zz", checked: true })).rejects.toThrow("member zz is not in the roster");
    await expect(r.commands[`${P}.member.set`]({ id: "a", checked: "yes" })).rejects.toThrow('checked must be a boolean, got "yes"');
    await expect(r.commands[`${P}.member.set`]({ checked: true })).rejects.toThrow("id must be a non-empty string, got undefined");
    expect(r.log).toEqual([]);
  });
});

describe("member.move", () => {
  it("moves a member to the index and redraws", async () => {
    const r = room();
    expect(await r.commands[`${P}.member.move`]({ id: "c", index: 0 })).toEqual({ id: "c", index: 0 });
    expect(r.roster.map((e) => e.id)).toEqual(["c", "a", "b"]);
    expect(r.log).toEqual(["changed"]);
  });

  it("refuses an index outside the roster and an unknown id", async () => {
    const r = room();
    await expect(r.commands[`${P}.member.move`]({ id: "a", index: 3 })).rejects.toThrow("index must be an integer from 0 to 2, got 3");
    await expect(r.commands[`${P}.member.move`]({ id: "zz", index: 0 })).rejects.toThrow("member zz is not in the roster");
    expect(r.roster.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });
});

describe("mode.set", () => {
  it("sets the mode and redraws, and refuses another value", async () => {
    const r = room();
    expect(await r.commands[`${P}.mode.set`]({ mode: "simul" })).toEqual({ mode: "simul" });
    expect(r.mode()).toBe("simul");
    expect(r.log).toEqual(["changed"]);
    await expect(r.commands[`${P}.mode.set`]({ mode: "solo" })).rejects.toThrow('mode must be facil, turn or simul, got "solo"');
    expect(r.mode()).toBe("simul");
  });
});

describe("message.send", () => {
  it("accepts the trimmed text, relays it and answers with the answers of the relay", async () => {
    const r = room();
    expect(await r.commands[`${P}.message.send`]({ text: "  hello " })).toEqual({ answers: [{ id: "b", text: "answer to hello" }] });
    expect(r.log).toEqual(["busy true", "accept hello", "busy false"]);
  });

  it("refuses an empty text, a send without an open member session and a send during a relay", async () => {
    await expect(room().commands[`${P}.message.send`]({ text: " " })).rejects.toThrow('text must be a non-empty string, got " "');
    await expect(room({ openMembers: () => 0 }).commands[`${P}.message.send`]({ text: "hi" })).rejects.toThrow(
      "no member session is open: check a member of the roster",
    );
    let finish: () => void = () => {};
    const r = room({ relay: () => new Promise((resolve) => (finish = () => resolve([]))) });
    const first = r.commands[`${P}.message.send`]({ text: "one" });
    await expect(r.commands[`${P}.message.send`]({ text: "two" })).rejects.toThrow("the room is relaying a message");
    finish();
    expect(await first).toEqual({ answers: [] });
  });

  it("ends the relay state when the relay fails, and rejects with its error", async () => {
    const r = room({ relay: async () => Promise.reject(new Error("member b: turn failed")) });
    await expect(r.commands[`${P}.message.send`]({ text: "hi" })).rejects.toThrow("member b: turn failed");
    expect(r.log).toEqual(["busy true", "accept hi", "busy false"]);
  });
});
