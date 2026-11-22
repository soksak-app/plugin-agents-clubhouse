// Summoning (C3) against the declared owned-session commands: core.session.open {plugin, params, size} returns {session}, and a
// refusal is an explicit error. The room port double answers with the declared shapes; the member session relation is the real
// project data store (createMemberSessionStore) over an in-memory data API.
import { describe, expect, it, vi } from "vitest";
import { summonMembers, type MemberDefinition } from "./summon";
import { createMemberSessionStore, MEMBER_SESSIONS } from "./session-store";
import type { RoomDataApi } from "./session-store";
import type { RoomPort } from "./port";

function fakeData(): RoomDataApi & { docs: Map<string, Record<string, unknown>> } {
  const docs = new Map<string, Record<string, unknown>>();
  return {
    docs,
    define: async () => {},
    put: async (_c, doc, opts) => {
      docs.set(opts?.id ?? String(docs.size), doc);
      return opts?.id ?? "0";
    },
    get: async (_c, id) => docs.get(id) ?? null,
  };
}

// The plugin that runs a member is a fixture id that this test declares: the room reads it from the definitions, never from its code.
const FIXTURE_PLUGIN = "fixture-terminal";

// Two definitions that name the fixture plugin.
const DEFINITIONS: MemberDefinition[] = [
  { id: "alpha", name: "Alpha", plugin: FIXTURE_PLUGIN, params: { program: "alpha-cli", args: [] }, cwd: "/work/app" },
  { id: "beta", name: "Beta", plugin: FIXTURE_PLUGIN, params: { program: "beta-cli", args: ["--fast"] }, cwd: "/work/app" },
];

const SIZE = { width: 400, height: 300, scale: 2 };

function roomPort(reply: (name: string, params: any) => unknown): { room: Pick<RoomPort, "commands">; calls: Array<{ name: string; params: any }> } {
  const calls: Array<{ name: string; params: any }> = [];
  const execute = vi.fn(async (name: string, params: any) => {
    calls.push({ name, params });
    return reply(name, params);
  });
  return { room: { commands: { execute } }, calls };
}

let counter = 0;
const openedSession = (_name: string, params: any) => ({ session: `s-${(counter += 1)}-${params.params.program}` });

// The sessions that core.sessions lists as open: a stored session that is not in this list was ended and is opened again.
const openSessions = (...sessions: string[]) => async () => sessions;

describe("summonMembers — one owned session per checked member", () => {
  it("opens each checked member with core.session.open in definition order and stores the relation", async () => {
    const data = fakeData();
    const sessions = createMemberSessionStore(data)!;
    const { room, calls } = roomPort(openedSession);
    const out = await summonMembers({ room, sessions, now: () => 42, openSessions: openSessions() }, { definitions: DEFINITIONS, checked: ["alpha", "beta"], size: async () => SIZE });
    expect(calls).toEqual([
      { name: "core.session.open", params: { plugin: FIXTURE_PLUGIN, params: { program: "alpha-cli", args: [] }, size: SIZE } },
      { name: "core.session.open", params: { plugin: FIXTURE_PLUGIN, params: { program: "beta-cli", args: ["--fast"] }, size: SIZE } },
    ]);
    expect(out.map((r) => [r.id, r.opened])).toEqual([["alpha", true], ["beta", true]]);
    expect(data.docs.get("alpha")).toEqual({ agentId: "alpha", sessionId: out[0].session, cwd: "/work/app", savedAt: 42 });
    expect(data.docs.get("beta")?.sessionId).toBe(out[1].session);
    expect(data.docs.has(MEMBER_SESSIONS)).toBe(false);
  });

  it("opens no session for a member that is not checked", async () => {
    const sessions = createMemberSessionStore(fakeData())!;
    const { room, calls } = roomPort(openedSession);
    await summonMembers({ room, sessions, now: () => 1, openSessions: openSessions() }, { definitions: DEFINITIONS, checked: ["beta"], size: async () => SIZE });
    expect(calls.map((c) => c.params.params.program)).toEqual(["beta-cli"]);
  });

  it("reuses a stored session that core.sessions still lists and opens none for that member", async () => {
    const data = fakeData();
    const sessions = createMemberSessionStore(data)!;
    await sessions.put({ agentId: "alpha", sessionId: "s-existing", cwd: "/work/app", savedAt: 1 });
    const { room, calls } = roomPort(openedSession);
    const out = await summonMembers({ room, sessions, now: () => 2, openSessions: openSessions("s-existing") }, { definitions: DEFINITIONS, checked: ["alpha"], size: async () => SIZE });
    expect(calls).toEqual([]);
    expect(out).toEqual([{ id: "alpha", session: "s-existing", opened: false }]);
  });

  it("opens the member again when its stored session is no longer open, and replaces the relation", async () => {
    const data = fakeData();
    const sessions = createMemberSessionStore(data)!;
    await sessions.put({ agentId: "alpha", sessionId: "s-ended", cwd: "/work/app", savedAt: 1 });
    const { room, calls } = roomPort(openedSession);
    const out = await summonMembers({ room, sessions, now: () => 3, openSessions: openSessions("s-other") }, { definitions: DEFINITIONS, checked: ["alpha"], size: async () => SIZE });
    expect(calls.map((c) => c.name)).toEqual(["core.session.open"]);
    expect(out).toEqual([{ id: "alpha", session: out[0].session, opened: true }]);
    expect(out[0].session).not.toBe("s-ended");
    expect(data.docs.get("alpha")?.sessionId).toBe(out[0].session);
  });

  it("a refusal of core rejects with its text, keeps the members opened before it, and stores nothing for the refused one", async () => {
    const data = fakeData();
    const sessions = createMemberSessionStore(data)!;
    const { room } = roomPort((_name, params) => {
      if (params.params.program === "beta-cli") throw new Error("plugin FIXTURE_PLUGIN declares no sessions");
      return openedSession(_name, params);
    });
    await expect(
      summonMembers({ room, sessions, now: () => 3, openSessions: openSessions() }, { definitions: DEFINITIONS, checked: ["alpha", "beta"], size: async () => SIZE }),
    ).rejects.toThrow("plugin FIXTURE_PLUGIN declares no sessions");
    expect(data.docs.has("alpha")).toBe(true);
    expect(data.docs.has("beta")).toBe(false);
  });

  it("a reply without a session identifier rejects instead of storing an undefined session", async () => {
    const data = fakeData();
    const sessions = createMemberSessionStore(data)!;
    const { room } = roomPort(() => ({ ok: true }));
    await expect(
      summonMembers({ room, sessions, now: () => 4, openSessions: openSessions() }, { definitions: DEFINITIONS, checked: ["alpha"], size: async () => SIZE }),
    ).rejects.toThrow("core.session.open reply has no session");
    expect(data.docs.size).toBe(0);
  });

  it("a size whose width, height or scale is not a positive number is refused before any session opens", async () => {
    const sessions = createMemberSessionStore(fakeData())!;
    const { room, calls } = roomPort(openedSession);
    for (const size of [{ ...SIZE, width: 0 }, { ...SIZE, height: -1 }, { ...SIZE, scale: Number.NaN }]) {
      await expect(
        summonMembers({ room, sessions, now: () => 5, openSessions: openSessions() }, { definitions: DEFINITIONS, checked: ["alpha"], size: async () => size }),
      ).rejects.toThrow("size width, height and scale must be positive numbers");
    }
    expect(calls).toEqual([]);
  });
});

describe("summonMembers — the size is measured only for a session that opens", () => {
  it("a member whose stored session is open is reattached without a size, so a room without a laid-out card reattaches", async () => {
    const sessions = createMemberSessionStore(fakeData())!;
    await sessions.put({ agentId: "alpha", sessionId: "s-kept", cwd: "/work/app", savedAt: 1 });
    const { room, calls } = roomPort(openedSession);
    const out = await summonMembers(
      { room, sessions, now: () => 8, openSessions: openSessions("s-kept") },
      {
        definitions: DEFINITIONS,
        checked: ["alpha"],
        size: async () => ({ width: 0, height: 0, scale: 2 }),
      },
    );
    expect(out).toEqual([{ id: "alpha", session: "s-kept", opened: false }]);
    expect(calls).toEqual([]);
  });
});

describe("summonMembers — the relation survives a restart", () => {
  it("a new store over the same project data returns the session of the earlier summon", async () => {
    const data = fakeData();
    const first = createMemberSessionStore(data)!;
    const { room } = roomPort(openedSession);
    const out = await summonMembers({ room, sessions: first, now: () => 6, openSessions: openSessions() }, { definitions: DEFINITIONS, checked: ["alpha"], size: async () => SIZE });
    const restarted = createMemberSessionStore(data)!;
    await expect(restarted.get("alpha")).resolves.toMatchObject({ sessionId: out[0].session });
  });
});

describe("summonMembers — definitions are validated at the boundary", () => {
  it("duplicate member identifiers are refused before any session opens", async () => {
    const sessions = createMemberSessionStore(fakeData())!;
    const { room, calls } = roomPort(openedSession);
    await expect(
      summonMembers({ room, sessions, now: () => 7, openSessions: openSessions() }, { definitions: [DEFINITIONS[0], DEFINITIONS[0]], checked: ["alpha"], size: async () => SIZE }),
    ).rejects.toThrow("member definitions must have unique ids");
    expect(calls).toEqual([]);
  });
});
