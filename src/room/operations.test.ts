// The commands of the room operations (C35, docs/spec/room.md#commands): member.set, member.move, mode.set and message.send.
import { describe, expect, it } from "vitest";
import { createRoomOperations, type OperationDeps } from "./operations";
import type { RosterEntry } from "./roster";
import type { RoomMode } from "./commands";

const P = "soksak-plugin-agents-clubhouse";

function room(overrides: Partial<OperationDeps> = {}) {
  const roster: RosterEntry[] = [
    { id: "a", name: "A", member: true, checked: false, role: "", leader: false },
    { id: "b", name: "B", member: true, checked: true, role: "", leader: false },
    { id: "c", name: "C", member: false, checked: false, role: "", leader: false },
  ];
  let mode: RoomMode = "turn";
  let folded = false;
  const log: string[] = [];
  const deps: OperationDeps = {
    roster,
    mode: () => mode,
    setMode: (next) => {
      mode = next;
    },
    folded: () => folded,
    setFolded: (next) => {
      folded = next;
    },
    changed: () => void log.push("changed"),
    summon: () => void log.push("summon"),
    leave: async (id) => void log.push(`leave ${id}`),
    openMembers: () => 1,
    accept: (text) => void log.push(`accept ${text}`),
    busy: (value) => void log.push(`busy ${value}`),
    relay: async (text) => [{ id: "b", text: `answer to ${text}` }],
    stopWaits: () => 0,
    followUp: () => void log.push("follow-up"),
    failed: (reason) => void log.push(`failed ${reason}`),
    ...overrides,
  };
  return { roster, log, mode: () => mode, folded: () => folded, commands: createRoomOperations(deps) };
}

describe("member.set", () => {
  it("checks a member and redraws without a summon, because the member has its session already", async () => {
    const r = room();
    expect(await r.commands[`${P}.member.set`]({ id: "a", checked: true })).toEqual({ id: "a", checked: true });
    expect(r.roster[0].checked).toBe(true);
    expect(r.log).toEqual(["changed"]);
    expect(await r.commands[`${P}.member.set`]({ id: "b", checked: false })).toEqual({ id: "b", checked: false });
    expect(r.roster[1]).toMatchObject({ member: true, checked: false });
  });

  it("refuses an entry that is no member of the room", async () => {
    const r = room();
    await expect(r.commands[`${P}.member.set`]({ id: "c", checked: true })).rejects.toThrow("member c is not a member of the room");
    expect(r.roster[2].checked).toBe(false);
    expect(r.log).toEqual([]);
  });

  it("is idempotent: the current state changes nothing and summons nothing", async () => {
    const r = room();
    expect(await r.commands[`${P}.member.set`]({ id: "b", checked: true })).toEqual({ id: "b", checked: true });
    expect(r.log).toEqual([]);
  });

  it("refuses an unknown id and a checked value that is not a boolean", async () => {
    const r = room();
    await expect(r.commands[`${P}.member.set`]({ id: "zz", checked: true, role: "" })).rejects.toThrow("member zz is not in the roster");
    await expect(r.commands[`${P}.member.set`]({ id: "a", checked: "yes" })).rejects.toThrow('checked must be a boolean, got "yes"');
    await expect(r.commands[`${P}.member.set`]({ checked: true, role: "" })).rejects.toThrow("id must be a non-empty string, got undefined");
    expect(r.log).toEqual([]);
  });
});

describe("member.join and member.leave (docs/spec/room.md#commands)", () => {
  it("member.join makes an entry a checked member and summons it, idempotently", async () => {
    const r = room();
    expect(await r.commands[`${P}.member.join`]({ id: "c" })).toEqual({ id: "c" });
    expect(r.roster[2]).toMatchObject({ member: true, checked: true });
    expect(r.log).toEqual(["changed", "summon"]);
    await r.commands[`${P}.member.join`]({ id: "c" });
    await r.commands[`${P}.member.join`]({ id: "a" });
    expect(r.roster[0]).toMatchObject({ member: true, checked: false });
    expect(r.log).toEqual(["changed", "summon"]);
    await expect(r.commands[`${P}.member.join`]({ id: "zz" })).rejects.toThrow("member zz is not in the roster");
  });

  it("member.leave clears the membership, the check and the leader and ends the session, idempotently", async () => {
    const r = room();
    r.roster[1].leader = true;
    expect(await r.commands[`${P}.member.leave`]({ id: "b" })).toEqual({ id: "b" });
    expect(r.roster[1]).toMatchObject({ member: false, checked: false, leader: false });
    expect(r.log).toEqual(["changed", "leave b"]);
    await r.commands[`${P}.member.leave`]({ id: "b" });
    await r.commands[`${P}.member.leave`]({ id: "c" });
    expect(r.log).toEqual(["changed", "leave b"]);
    await expect(r.commands[`${P}.member.leave`]({ id: "zz" })).rejects.toThrow("member zz is not in the roster");
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
    await expect(r.commands[`${P}.mode.set`]({ mode: "solo" })).rejects.toThrow('mode must be turn or simul, got "solo"');
    await expect(r.commands[`${P}.mode.set`]({ mode: "facil" })).rejects.toThrow('mode must be turn or simul, got "facil"');
    expect(r.mode()).toBe("simul");
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
    await expect(closed.commands[`${P}.message.send`]({ text: "hi" })).rejects.toThrow(
      "no member session is open: check a member of the roster",
    );
    expect(closed.log).toEqual(["failed no member session is open: check a member of the roster"]);
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

describe("member.leader (docs/spec/room.md#leader)", () => {
  it("makes one entry the leader, checks it and clears the leader of every other entry, idempotently", async () => {
    const r = room();
    r.roster[1].leader = true;
    expect(await r.commands[`${P}.member.leader`]({ id: "a", leader: true })).toEqual({ id: "a", leader: true });
    expect(r.roster.map((entry) => [entry.id, entry.checked, entry.leader])).toEqual([["a", true, true], ["b", true, false], ["c", false, false]]);
    expect(r.log).toEqual(["changed"]);
    await r.commands[`${P}.member.leader`]({ id: "a", leader: true });
    expect(r.log).toEqual(["changed"]);
    await expect(r.commands[`${P}.member.leader`]({ id: "c", leader: true })).rejects.toThrow("member c is not a member of the room");
    await r.commands[`${P}.member.leader`]({ id: "a", leader: false });
    expect(r.roster.every((entry) => !entry.leader)).toBe(true);
    await expect(r.commands[`${P}.member.leader`]({ id: "a", leader: "yes" })).rejects.toThrow('leader must be a boolean, got "yes"');
  });
});
