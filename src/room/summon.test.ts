// Summoning (C3) against the declared owned-session commands: core.session.open {plugin, params, size} returns {session}, and a
// refusal is an explicit error. The room port double answers with the declared shapes; the member session relation is the real
// project data store (createMemberSessionStore) over an in-memory data API.
import { describe, expect, it, vi } from "vitest";
import { createOpenedSessions, summonMembers, type MemberDefinition } from "./summon";
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

describe("summonMembers — one owned session per starting member", () => {
  it("opens each starting member with core.session.open in definition order and stores the relation", async () => {
    const data = fakeData();
    const sessions = createMemberSessionStore(data, "room-1");
    const { room, calls } = roomPort(openedSession);
    const out = await summonMembers({ room, sessions, now: () => 42, openSessions: openSessions(), opened: createOpenedSessions() }, { definitions: DEFINITIONS, starting: ["alpha", "beta"], size: async () => SIZE });
    expect(calls).toEqual([
      { name: "core.session.open", params: { plugin: FIXTURE_PLUGIN, params: { program: "alpha-cli", args: [] }, size: SIZE } },
      { name: "core.session.open", params: { plugin: FIXTURE_PLUGIN, params: { program: "beta-cli", args: ["--fast"] }, size: SIZE } },
    ]);
    expect(out.map((r) => [r.id, r.opened])).toEqual([["alpha", true], ["beta", true]]);
    expect(data.docs.get("room-1/alpha")).toEqual({ surface: "room-1", agentId: "alpha", sessionId: out[0].session, cwd: "/work/app", savedAt: 42 });
    expect(data.docs.get("room-1/beta")?.sessionId).toBe(out[1].session);
    expect(data.docs.has(MEMBER_SESSIONS)).toBe(false);
  });

  it("opens no session for a member that is not starting", async () => {
    const sessions = createMemberSessionStore(fakeData(), "room-1");
    const { room, calls } = roomPort(openedSession);
    await summonMembers({ room, sessions, now: () => 1, openSessions: openSessions(), opened: createOpenedSessions() }, { definitions: DEFINITIONS, starting: ["beta"], size: async () => SIZE });
    expect(calls.map((c) => c.params.params.program)).toEqual(["beta-cli"]);
  });

  it("reuses a stored session that core.sessions still lists and opens none for that member", async () => {
    const data = fakeData();
    const sessions = createMemberSessionStore(data, "room-1");
    await sessions.put({ agentId: "alpha", sessionId: "s-existing", cwd: "/work/app", savedAt: 1 });
    const { room, calls } = roomPort(openedSession);
    const out = await summonMembers({ room, sessions, now: () => 2, openSessions: openSessions("s-existing"), opened: createOpenedSessions() }, { definitions: DEFINITIONS, starting: ["alpha"], size: async () => SIZE });
    expect(calls).toEqual([]);
    expect(out).toEqual([{ id: "alpha", session: "s-existing", opened: false }]);
  });

  it("opens the member again when its stored session is no longer open, and replaces the relation", async () => {
    const data = fakeData();
    const sessions = createMemberSessionStore(data, "room-1");
    await sessions.put({ agentId: "alpha", sessionId: "s-ended", cwd: "/work/app", savedAt: 1 });
    const { room, calls } = roomPort(openedSession);
    const out = await summonMembers({ room, sessions, now: () => 3, openSessions: openSessions("s-other"), opened: createOpenedSessions() }, { definitions: DEFINITIONS, starting: ["alpha"], size: async () => SIZE });
    expect(calls.map((c) => c.name)).toEqual(["core.session.open"]);
    expect(out).toEqual([{ id: "alpha", session: out[0].session, opened: true }]);
    expect(out[0].session).not.toBe("s-ended");
    expect(data.docs.get("room-1/alpha")?.sessionId).toBe(out[0].session);
  });

  it("a refusal of core rejects with its text, keeps the members opened before it, and stores nothing for the refused one", async () => {
    const data = fakeData();
    const sessions = createMemberSessionStore(data, "room-1");
    const { room } = roomPort((_name, params) => {
      if (params.params.program === "beta-cli") throw new Error("plugin FIXTURE_PLUGIN declares no sessions");
      return openedSession(_name, params);
    });
    await expect(
      summonMembers({ room, sessions, now: () => 3, openSessions: openSessions(), opened: createOpenedSessions() }, { definitions: DEFINITIONS, starting: ["alpha", "beta"], size: async () => SIZE }),
    ).rejects.toThrow("plugin FIXTURE_PLUGIN declares no sessions");
    expect(data.docs.has("room-1/alpha")).toBe(true);
    expect(data.docs.has("room-1/beta")).toBe(false);
  });

  it("a reply without a session identifier rejects instead of storing an undefined session", async () => {
    const data = fakeData();
    const sessions = createMemberSessionStore(data, "room-1");
    const { room } = roomPort(() => ({ ok: true }));
    await expect(
      summonMembers({ room, sessions, now: () => 4, openSessions: openSessions(), opened: createOpenedSessions() }, { definitions: DEFINITIONS, starting: ["alpha"], size: async () => SIZE }),
    ).rejects.toThrow("core.session.open reply has no session");
    expect(data.docs.size).toBe(0);
  });

  it("a size whose width, height or scale is not a positive number is refused before any session opens", async () => {
    const sessions = createMemberSessionStore(fakeData(), "room-1");
    const { room, calls } = roomPort(openedSession);
    for (const size of [{ ...SIZE, width: 0 }, { ...SIZE, height: -1 }, { ...SIZE, scale: Number.NaN }]) {
      await expect(
        summonMembers({ room, sessions, now: () => 5, openSessions: openSessions(), opened: createOpenedSessions() }, { definitions: DEFINITIONS, starting: ["alpha"], size: async () => size }),
      ).rejects.toThrow("size width, height and scale must be positive numbers");
    }
    expect(calls).toEqual([]);
  });
});

describe("summonMembers — the size is measured only for a session that opens", () => {
  it("a member whose stored session is open is reattached without a size, so a room without a laid-out card reattaches", async () => {
    const sessions = createMemberSessionStore(fakeData(), "room-1");
    await sessions.put({ agentId: "alpha", sessionId: "s-kept", cwd: "/work/app", savedAt: 1 });
    const { room, calls } = roomPort(openedSession);
    const out = await summonMembers(
      { room, sessions, now: () => 8, openSessions: openSessions("s-kept"), opened: createOpenedSessions() },
      {
        definitions: DEFINITIONS,
        starting: ["alpha"],
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
    const first = createMemberSessionStore(data, "room-1");
    const { room } = roomPort(openedSession);
    const out = await summonMembers({ room, sessions: first, now: () => 6, openSessions: openSessions(), opened: createOpenedSessions() }, { definitions: DEFINITIONS, starting: ["alpha"], size: async () => SIZE });
    const restarted = createMemberSessionStore(data, "room-1");
    await expect(restarted.get("alpha")).resolves.toMatchObject({ sessionId: out[0].session });
  });
});

describe("summonMembers — definitions are validated at the boundary", () => {
  it("duplicate member identifiers are refused before any session opens", async () => {
    const sessions = createMemberSessionStore(fakeData(), "room-1");
    const { room, calls } = roomPort(openedSession);
    await expect(
      summonMembers({ room, sessions, now: () => 7, openSessions: openSessions(), opened: createOpenedSessions() }, { definitions: [DEFINITIONS[0], DEFINITIONS[0]], starting: ["alpha"], size: async () => SIZE }),
    ).rejects.toThrow("member definitions must have unique ids");
    expect(calls).toEqual([]);
  });
});

// The causes of a second session of one member (docs/spec/room.md#restart): a relation shared by two rooms, a relation that the store
// refused to put, and a summon that runs before core.sessions lists the session that the previous summon opened.
describe("summonMembers — no second session of one member", () => {
  it("keeps the relations of two room surfaces of one project apart", async () => {
    const data = fakeData();
    const { room } = roomPort(openedSession);
    const first = await summonMembers(
      { room, sessions: createMemberSessionStore(data, "room-1"), now: () => 1, openSessions: openSessions(), opened: createOpenedSessions() },
      { definitions: DEFINITIONS, starting: ["alpha"], size: async () => SIZE },
    );
    const second = await summonMembers(
      { room, sessions: createMemberSessionStore(data, "room-2"), now: () => 2, openSessions: openSessions(first[0].session), opened: createOpenedSessions() },
      { definitions: DEFINITIONS, starting: ["alpha"], size: async () => SIZE },
    );
    expect(data.docs.get("room-1/alpha")?.sessionId).toBe(first[0].session);
    expect(data.docs.get("room-2/alpha")?.sessionId).toBe(second[0].session);
    expect(second[0].session).not.toBe(first[0].session);
  });

  it("ends the session whose relation the store refused to put, and rejects with the reason", async () => {
    const data = fakeData();
    data.put = async () => {
      throw new Error("project data full");
    };
    const { room, calls } = roomPort((name, params) => (name === "core.session.open" ? openedSession(name, params) : {}));
    await expect(
      summonMembers(
        { room, sessions: createMemberSessionStore(data, "room-1"), now: () => 1, openSessions: openSessions(), opened: createOpenedSessions() },
        { definitions: DEFINITIONS, starting: ["alpha"], size: async () => SIZE },
      ),
    ).rejects.toThrow(/^member alpha: the relation was not stored: project data full; session s-\d+-alpha-cli ended$/);
    const opened = calls.find((call) => call.name === "core.session.open");
    expect(opened).toBeDefined();
    expect(calls.filter((call) => call.name === "core.session.end").map((call) => call.params.session)).toHaveLength(1);
  });

  it("opens no second session when a summon runs before core.sessions lists the session of the previous summon", async () => {
    const data = fakeData();
    const sessions = createMemberSessionStore(data, "room-1");
    const opened = createOpenedSessions();
    const { room, calls } = roomPort(openedSession);
    const deps = { room, sessions, now: () => 1, openSessions: openSessions(), opened };
    const first = await summonMembers(deps, { definitions: DEFINITIONS, starting: ["alpha"], size: async () => SIZE });
    const second = await summonMembers(deps, { definitions: DEFINITIONS, starting: ["alpha"], size: async () => SIZE });
    expect(calls.filter((call) => call.name === "core.session.open")).toHaveLength(1);
    expect(second).toEqual([{ id: "alpha", session: first[0].session, opened: false }]);
  });
});
