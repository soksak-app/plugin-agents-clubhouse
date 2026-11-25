// The commands of the room operations (C35, C140, docs/spec/room.md#commands): group.set, members.fold, message.send and conversation.stop.
import { describe, expect, it } from "vitest";
import { createRoomOperations, type OperationDeps } from "./operations";

const P = "soksak-plugin-agents-clubhouse";

function room(overrides: Partial<OperationDeps> = {}) {
  let group: string | null = "g1";
  let folded = false;
  const log: string[] = [];
  const deps: OperationDeps = {
    group: () => group,
    setGroup: (next) => {
      group = next;
    },
    groupDefined: async (id) => id === "g1" || id === "g2",
    folded: () => folded,
    setFolded: (next) => {
      folded = next;
    },
    changed: () => void log.push("changed"),
    summon: () => void log.push("summon"),
    openMembers: () => 1,
    accept: (text) => void log.push(`accept ${text}`),
    busy: (value) => void log.push(`busy ${value}`),
    relay: async (text) => [{ id: "b", text: `answer to ${text}` }],
    stopWaits: () => 0,
    followUp: () => void log.push("follow-up"),
    failed: (reason) => void log.push(`failed ${reason}`),
    ...overrides,
  };
  return { log, group: () => group, folded: () => folded, commands: createRoomOperations(deps) };
}

describe("group.set (docs/spec/room.md#group)", () => {
  it("assigns a stored group, redraws and summons its members, and changes nothing for the assigned group", async () => {
    const r = room();
    expect(await r.commands[`${P}.group.set`]({ group: "g2" })).toEqual({ group: "g2" });
    expect(r.group()).toBe("g2");
    expect(r.log).toEqual(["changed", "summon"]);
    expect(await r.commands[`${P}.group.set`]({ group: "g2" })).toEqual({ group: "g2" });
    expect(r.log).toEqual(["changed", "summon"]);
  });

  it("refuses a group that the agents plugin does not store and a value that is no group identifier", async () => {
    const r = room();
    await expect(r.commands[`${P}.group.set`]({ group: "g9" })).rejects.toThrow("group g9 is not defined");
    await expect(r.commands[`${P}.group.set`]({ group: "" })).rejects.toThrow('group must be a group identifier, got ""');
    expect(r.group()).toBe("g1");
    expect(r.log).toEqual([]);
  });
});

describe("mode.set (C141, docs/spec/room.md#receivers)", () => {
  it("is no command, because the room has no conversation mode", () => {
    expect(Object.keys(room().commands).some((name) => name.endsWith(".mode.set"))).toBe(false);
  });
});

describe("members.fold", () => {
  it("folds and unfolds the member grid and redraws, and refuses a value that is not a boolean", async () => {
    const r = room();
    expect(await r.commands[`${P}.members.fold`]({ folded: true })).toEqual({ folded: true });
    expect(r.folded()).toBe(true);
    expect(await r.commands[`${P}.members.fold`]({ folded: true })).toEqual({ folded: true });
    expect(r.log).toEqual(["changed"]);
    await expect(r.commands[`${P}.members.fold`]({ folded: "yes" })).rejects.toThrow('folded must be true or false, got "yes"');
    expect(await r.commands[`${P}.members.fold`]({ folded: false })).toEqual({ folded: false });
    expect(r.folded()).toBe(false);
  });
});

describe("message.send", () => {
  it("accepts the trimmed text, relays it and answers with the answers of the relay", async () => {
    const r = room();
    expect(await r.commands[`${P}.message.send`]({ text: "  hello " })).toEqual({ answers: [{ id: "b", text: "answer to hello" }] });
    expect(r.log).toEqual(["busy true", "accept hello", "busy false"]);
  });

  it("refuses an empty text and a send without an open member session, and takes a send during a relay", async () => {
    const empty = room();
    await expect(empty.commands[`${P}.message.send`]({ text: " " })).rejects.toThrow('text must be a non-empty string, got " "');
    expect(empty.log).toEqual(['failed text must be a non-empty string, got " "']);
    const closed = room({ openMembers: () => 0 });
    await expect(closed.commands[`${P}.message.send`]({ text: "hi" })).rejects.toThrow("no member session is open");
    expect(closed.log).toEqual(["failed no member session is open"]);
    const groupless = room({ group: () => null });
    await expect(groupless.commands[`${P}.message.send`]({ text: "hi" })).rejects.toThrow("no group is assigned");
    expect(groupless.log).toEqual(["failed no group is assigned"]);
    let finish: () => void = () => {};
    const r = room({ relay: () => new Promise((resolve) => (finish = () => resolve([]))) });
    const first = r.commands[`${P}.message.send`]({ text: "one" });
    // A send during a relay adds the owner line to the running conversation (docs/spec/room.md#owner-follow-up).
    expect(await r.commands[`${P}.message.send`]({ text: "two" })).toEqual({ answers: [] });
    expect(r.log).toContain("accept two");
    expect(r.log).toContain("follow-up");
    finish();
    expect(await first).toEqual({ answers: [] });
  });

  it("ends the relay state when the relay fails, reports the failure and rejects with its error", async () => {
    const r = room({ relay: async () => Promise.reject(new Error("member b: turn failed")) });
    await expect(r.commands[`${P}.message.send`]({ text: "hi" })).rejects.toThrow("member b: turn failed");
    expect(r.log).toEqual(["busy true", "accept hi", "busy false", "failed member b: turn failed"]);
  });
});

describe("conversation.stop (docs/spec/room.md#conversation)", () => {
  it("refuses a stop without a relay", async () => {
    const r = room();
    await expect(r.commands[`${P}.conversation.stop`]({})).rejects.toThrow("the room is relaying no message");
  });

  it("ends the waits of the kept tokens without a relay and answers that it stopped (docs/spec/room.md#commands)", async () => {
    let stops = 0;
    const r = room({ stopWaits: () => (stops += 1, 2) });
    expect(await r.commands[`${P}.conversation.stop`]({})).toEqual({ stopped: true });
    expect(stops).toBe(1);
  });

  it("tells the running relay to stop, idempotently, and a later send starts unstopped", async () => {
    let finish: () => void = () => {};
    const seen: (() => boolean)[] = [];
    const r = room({
      relay: (_text, stopped) => {
        seen.push(stopped);
        return new Promise((resolve) => (finish = () => resolve([])));
      },
    });
    const first = r.commands[`${P}.message.send`]({ text: "one" });
    expect(seen[0]()).toBe(false);
    expect(await r.commands[`${P}.conversation.stop`]({})).toEqual({ stopped: true });
    expect(await r.commands[`${P}.conversation.stop`]({})).toEqual({ stopped: true });
    expect(seen[0]()).toBe(true);
    finish();
    await first;
    const second = r.commands[`${P}.message.send`]({ text: "two" });
    expect(seen[1]()).toBe(false);
    finish();
    await second;
  });
});
