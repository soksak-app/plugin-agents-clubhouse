// Summoning (C3) against the declared owned-session commands: core.session.open {plugin, params, cols, rows} returns
// {session}, and a refusal is an explicit error. The room port double answers with the declared shapes; the member
// session relation is the real project data store (createMemberSessionStore) over an in-memory data API.
import { describe, expect, it, vi } from "vitest";
import { summonMembers, type MemberDefinition } from "./summon";
import { createMemberSessionStore, MEMBER_SESSIONS } from "./session-store";
import type { PersonaDataApi } from "./persona";
import type { RoomPort } from "./port";

function fakeData(): PersonaDataApi & { docs: Map<string, Record<string, unknown>> } {
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

// Two definitions with a neutral plugin reference: the room reads them from the agents definitions, not from its code.
const DEFINITIONS: MemberDefinition[] = [
  { id: "alpha", plugin: "example.terminal", params: { program: "alpha-cli", args: [] }, cwd: "/work/app" },
  { id: "beta", plugin: "example.terminal", params: { program: "beta-cli", args: ["--fast"] }, cwd: "/work/app" },
];

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

describe("summonMembers — one owned session per checked member", () => {
  it("opens each checked member with core.session.open in definition order and stores the relation", async () => {
    const data = fakeData();
    const sessions = createMemberSessionStore(data)!;
    const { room, calls } = roomPort(openedSession);
    const out = await summonMembers({ room, sessions, now: () => 42 }, { definitions: DEFINITIONS, checked: ["alpha", "beta"], cols: 120, rows: 32 });
    expect(calls).toEqual([
      { name: "core.session.open", params: { plugin: "example.terminal", params: { program: "alpha-cli", args: [] }, cols: 120, rows: 32 } },
      { name: "core.session.open", params: { plugin: "example.terminal", params: { program: "beta-cli", args: ["--fast"] }, cols: 120, rows: 32 } },
    ]);
    expect(out.map((r) => [r.id, r.opened])).toEqual([["alpha", true], ["beta", true]]);
    expect(data.docs.get("alpha")).toEqual({ agentId: "alpha", sessionId: out[0].session, cwd: "/work/app", savedAt: 42 });
    expect(data.docs.get("beta")?.sessionId).toBe(out[1].session);
    expect(data.docs.has(MEMBER_SESSIONS)).toBe(false);
  });

  it("opens no session for a member that is not checked", async () => {
    const sessions = createMemberSessionStore(fakeData())!;
    const { room, calls } = roomPort(openedSession);
    await summonMembers({ room, sessions, now: () => 1 }, { definitions: DEFINITIONS, checked: ["beta"], cols: 80, rows: 24 });
    expect(calls.map((c) => c.params.params.program)).toEqual(["beta-cli"]);
  });

  it("reuses a stored session and opens none for that member", async () => {
    const data = fakeData();
    const sessions = createMemberSessionStore(data)!;
    await sessions.put({ agentId: "alpha", sessionId: "s-existing", cwd: "/work/app", savedAt: 1 });
    const { room, calls } = roomPort(openedSession);
    const out = await summonMembers({ room, sessions, now: () => 2 }, { definitions: DEFINITIONS, checked: ["alpha"], cols: 80, rows: 24 });
    expect(calls).toEqual([]);
    expect(out).toEqual([{ id: "alpha", session: "s-existing", opened: false }]);
  });

  it("a refusal of core rejects with its text, keeps the members opened before it, and stores nothing for the refused one", async () => {
    const data = fakeData();
    const sessions = createMemberSessionStore(data)!;
    const { room } = roomPort((_name, params) => {
      if (params.params.program === "beta-cli") throw new Error("plugin example.terminal declares no sessions");
      return openedSession(_name, params);
    });
    await expect(
      summonMembers({ room, sessions, now: () => 3 }, { definitions: DEFINITIONS, checked: ["alpha", "beta"], cols: 80, rows: 24 }),
    ).rejects.toThrow("plugin example.terminal declares no sessions");
    expect(data.docs.has("alpha")).toBe(true);
    expect(data.docs.has("beta")).toBe(false);
  });

  it("a reply without a session identifier rejects instead of storing an undefined session", async () => {
    const data = fakeData();
    const sessions = createMemberSessionStore(data)!;
    const { room } = roomPort(() => ({ ok: true }));
    await expect(
      summonMembers({ room, sessions, now: () => 4 }, { definitions: DEFINITIONS, checked: ["alpha"], cols: 80, rows: 24 }),
    ).rejects.toThrow("core.session.open reply has no session");
    expect(data.docs.size).toBe(0);
  });

  it("a size that is not a positive integer is refused before any session opens", async () => {
    const sessions = createMemberSessionStore(fakeData())!;
    const { room, calls } = roomPort(openedSession);
    await expect(
      summonMembers({ room, sessions, now: () => 5 }, { definitions: DEFINITIONS, checked: ["alpha"], cols: 0, rows: 24 }),
    ).rejects.toThrow("summon size must be positive integers");
    expect(calls).toEqual([]);
  });
});

describe("summonMembers — the relation survives a restart", () => {
  it("a new store over the same project data returns the session of the earlier summon", async () => {
    const data = fakeData();
    const first = createMemberSessionStore(data)!;
    const { room } = roomPort(openedSession);
    const out = await summonMembers({ room, sessions: first, now: () => 6 }, { definitions: DEFINITIONS, checked: ["alpha"], cols: 80, rows: 24 });
    const restarted = createMemberSessionStore(data)!;
    await expect(restarted.get("alpha")).resolves.toMatchObject({ sessionId: out[0].session });
  });
});

describe("summonMembers — definitions are validated at the boundary", () => {
  it("duplicate member identifiers are refused before any session opens", async () => {
    const sessions = createMemberSessionStore(fakeData())!;
    const { room, calls } = roomPort(openedSession);
    await expect(
      summonMembers({ room, sessions, now: () => 7 }, { definitions: [DEFINITIONS[0], DEFINITIONS[0]], checked: ["alpha"], cols: 80, rows: 24 }),
    ).rejects.toThrow("member definitions must have unique ids");
    expect(calls).toEqual([]);
  });
});
