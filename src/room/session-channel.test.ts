// The owner side of an owned session (C5) against the declared owner commands of core (core docs/spec/plugins.md#owned-sessions):
// core.session.submit {session, text} answers {}, and the program state of a
// session is read from its entry of core.sessions. The port double answers with those shapes; no module is mocked.
import { describe, expect, it, vi } from "vitest";
import { sessionProgram, sessionSubmit } from "./session-channel";

function port(reply: (name: string, params: Record<string, unknown>) => unknown = () => ({})) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const execute = vi.fn(async (name: string, params: Record<string, unknown>) => {
    calls.push([name, params]);
    return reply(name, params);
  });
  return { calls, port: { commands: { execute } } };
}

describe("sessionSubmit", () => {
  it("sends the line with core.session.submit, which pastes it and sends Enter", async () => {
    const { calls, port: p } = port();
    await sessionSubmit(p, "s-1")("hello");
    expect(calls).toEqual([["core.session.submit", { session: "s-1", text: "hello" }]]);
  });

  it("refuses a session that is not a non-empty text, and sends nothing", () => {
    const { calls, port: p } = port();
    expect(() => sessionSubmit(p, "")).toThrow("session must be a non-empty text");
    expect(calls).toEqual([]);
  });

  it("refuses a text that is not a string, and sends nothing", async () => {
    const { calls, port: p } = port();
    const send = sessionSubmit(p, "s-1") as unknown as (text: unknown) => Promise<void>;
    await expect(send(42)).rejects.toThrow("submit text must be a string");
    expect(calls).toEqual([]);
  });

  it("rejects with the refusal of core unchanged, such as a line break", async () => {
    const { port: p } = port(() => {
      throw new Error("core.session.submit text must not contain CR or LF");
    });
    await expect(sessionSubmit(p, "s-1")("a\nb")).rejects.toThrow("core.session.submit text must not contain CR or LF");
  });

  it("rejects a reply that is not an object", async () => {
    const { port: p } = port(() => "ok");
    await expect(sessionSubmit(p, "s-1")("x")).rejects.toThrow("core.session.submit reply is not an object");
  });
});

describe("sessionProgram", () => {
  const sessions = [
    { session: "s-1", plugin: "p", owner: "room", shownBy: null, program: { state: "idle" } },
    { session: "s-2", plugin: "p", owner: "room", shownBy: null, program: null },
  ];

  it("returns the program state of the listed session", () => {
    expect(sessionProgram(sessions, "s-1")).toBe("idle");
  });

  it("returns null for a session whose program state is null", () => {
    expect(sessionProgram(sessions, "s-2")).toBeNull();
  });

  it("refuses a session that core.sessions does not list", () => {
    expect(() => sessionProgram(sessions, "s-9")).toThrow("session s-9 is not open");
  });

  it("refuses a state that is not idle, working or blocked", () => {
    expect(() => sessionProgram([{ session: "s-1", program: { state: "done" } }], "s-1")).toThrow("program state done is not idle, working or blocked");
  });
});

describe("ownedSessionIds (docs/spec/room.md#restart)", () => {
  it("lists the sessions of core.sessions that this surface owns", async () => {
    const { ownedSessionIds } = await import("./session-channel");
    const value = [
      { session: "owned-a", owner: "tab-room", program: null },
      { session: "owned-b", owner: "tab-other", program: null },
    ];
    expect([...ownedSessionIds(value, "tab-room")]).toEqual(["owned-a"]);
    expect(() => ownedSessionIds({}, "tab-room")).toThrow("core.sessions is not a list");
  });
});

describe("ownedSessionEntries (docs/spec/room.md#login)", () => {
  it("lists the sessions of the surface with their showing tab, null for a session that no tab shows, and their params", async () => {
    const { ownedSessionEntries } = await import("./session-channel");
    const value = [
      { session: "owned-a", owner: "tab-room", shownBy: "tab-1", params: { program: "env" } },
      { session: "owned-b", owner: "tab-room", shownBy: null, params: null },
      { session: "owned-c", owner: "tab-other", shownBy: "tab-2" },
    ];
    expect(ownedSessionEntries(value, "tab-room")).toEqual([{ session: "owned-a", shownBy: "tab-1", params: { program: "env" } }, { session: "owned-b", shownBy: null, params: null }]);
    expect(() => ownedSessionEntries({}, "tab-room")).toThrow("core.sessions is not a list");
  });
});
