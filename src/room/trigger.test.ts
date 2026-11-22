// The summon trigger of the room (C3-1) and the arrangement after it (C4): a check of the roster summons the checked members, and the
// members that open are arranged. The room port double answers with the declared shapes; the session store is the real one over an
// in-memory data API. Calls of the trigger run one after the other.
import { describe, expect, it } from "vitest";
import { summonAndArrange, serialRunner } from "./trigger";
import { createArrangementStatus } from "./arrangement";
import { createMemberSessionStore } from "./session-store";
import type { RoomDataApi } from "./session-store";
import type { MemberDefinition } from "./summon";

const SIZE = { width: 480, height: 320, scale: 2 };

function fakeData(): RoomDataApi {
  const docs = new Map<string, Record<string, unknown>>();
  return {
    define: async () => {},
    put: async (_c, doc, opts) => {
      const id = opts?.id ?? String(doc.id);
      docs.set(id, { ...doc, id });
      return id;
    },
    get: async (_c, id) => docs.get(id) ?? null,
  };
}

function fakeRoom(options: { feasible?: boolean; refuseOpen?: string } = {}) {
  const calls: { name: string; params: Record<string, unknown> }[] = [];
  let opened = 0;
  return {
    calls,
    room: {
      commands: {
        execute: async (name: string, params: Record<string, unknown>) => {
          calls.push({ name, params });
          if (name === "core.session.open") {
            if (options.refuseOpen === params.plugin) throw new Error(`plugin ${params.plugin} declares no sessions`);
            opened += 1;
            return { session: `s-${opened}` };
          }
          if (name === "core.layout.plan") return { feasible: options.feasible ?? true, reason: "no room" };
          return null;
        },
      },
      report: () => {},
    },
  };
}

const DEFINITIONS: MemberDefinition[] = [
  { id: "reviewer", plugin: "terminal", params: { program: "claude", args: [], directory: "/a", role: "reviewer" }, cwd: "/a" },
  { id: "writer", plugin: "terminal", params: { program: "codex", args: [], directory: "/b", role: "writer" }, cwd: "/b" },
];

function deps(room: ReturnType<typeof fakeRoom>["room"]) {
  return {
    summon: {
      room,
      sessions: createMemberSessionStore(fakeData())!,
      now: () => 1,
      openSessions: async () => [],
    },
    arrange: { commands: room.commands, report: room.report },
    status: createArrangementStatus(),
    size: async () => SIZE,
    ended: () => false,
  };
}

describe("summonAndArrange", () => {
  it("summons only the checked members in definition order and arranges the members that opened", async () => {
    const fake = fakeRoom();
    const d = deps(fake.room);
    const result = await summonAndArrange(d, DEFINITIONS, ["writer", "reviewer"]);
    expect(result).toEqual({ state: "group" });
    const opens = fake.calls.filter((call) => call.name === "core.session.open");
    expect(opens.map((call) => call.params.params)).toEqual([DEFINITIONS[0]!.params, DEFINITIONS[1]!.params]);
    expect(opens[0]!.params).toMatchObject({ plugin: "terminal", size: SIZE });
    const apply = fake.calls.find((call) => call.name === "core.layout.apply");
    expect(apply).toBeDefined();
    expect(d.status.read()).toEqual({ state: "group" });
  });

  it("opens each member as a tab with the reason when the plan is not feasible", async () => {
    const fake = fakeRoom({ feasible: false });
    const d = deps(fake.room);
    expect(await summonAndArrange(d, DEFINITIONS, ["reviewer"])).toEqual({ state: "tabs", reason: "no room" });
    const tabs = fake.calls.filter((call) => call.name === "core.layout.open");
    expect(tabs).toEqual([{ name: "core.layout.open", params: { card: "current", plugin: "terminal", params: { session: "s-1" } } }]);
  });

  it("with no checked member, summons nothing and leaves the arrangement idle", async () => {
    const fake = fakeRoom();
    const d = deps(fake.room);
    expect(await summonAndArrange(d, DEFINITIONS, [])).toEqual({ state: "idle" });
    expect(fake.calls).toEqual([]);
  });

  it("rejects with the refusal of core and arranges nothing when a summon is refused", async () => {
    const fake = fakeRoom({ refuseOpen: "terminal" });
    const d = deps(fake.room);
    await expect(summonAndArrange(d, DEFINITIONS, ["reviewer"])).rejects.toThrow("plugin terminal declares no sessions");
    expect(fake.calls.some((call) => call.name === "core.layout.plan")).toBe(false);
  });
});

describe("serialRunner", () => {
  it("starts each task after the previous one has settled, even when it fails", async () => {
    const run = serialRunner();
    const order: string[] = [];
    const first = run(async () => { order.push("first:start"); await Promise.resolve(); order.push("first:end"); throw new Error("boom"); });
    const second = run(async () => { order.push("second"); return 2; });
    await expect(first).rejects.toThrow("boom");
    expect(await second).toBe(2);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });
});
