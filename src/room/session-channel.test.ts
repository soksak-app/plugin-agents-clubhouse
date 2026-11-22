// The owner side of an owned session (C5) against the commands core.session.input {session, text} and core.session.read {session}
// (core F1062-7, not yet merged). The room calls them as the owner surface of the session; the port double records each call and
// rejects with the text the test gives it, and no module is mocked.
import { describe, expect, it, vi } from "vitest";
import { sessionInput, sessionRead } from "./session-channel";

function port(reply: (name: string, params: Record<string, unknown>) => unknown = () => ({ ok: true })) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const execute = vi.fn(async (name: string, params: Record<string, unknown>) => {
    calls.push([name, params]);
    return reply(name, params);
  });
  return { calls, port: { commands: { execute } } };
}

describe("sessionInput", () => {
  it("sends the text to the owned session with core.session.input", async () => {
    const { calls, port: p } = port();
    await sessionInput(p, "s-1")("hello");
    expect(calls).toEqual([["core.session.input", { session: "s-1", text: "hello" }]]);
  });

  it("passes the text unchanged, so the line break of the text reaches core as the room wrote it", async () => {
    const { calls, port: p } = port();
    await sessionInput(p, "s-1")("line one\nline two");
    expect(calls[0][1]).toEqual({ session: "s-1", text: "line one\nline two" });
  });

  it("refuses a session that is not a non-empty text, and sends nothing", async () => {
    const { calls, port: p } = port();
    expect(() => sessionInput(p, "")).toThrow("session must be a non-empty text");
    expect(calls).toEqual([]);
  });

  it("refuses a text that is not a string, and sends nothing", async () => {
    const { calls, port: p } = port();
    const send = sessionInput(p, "s-1") as unknown as (text: unknown) => Promise<void>;
    await expect(send(42)).rejects.toThrow("input text must be a string");
    expect(calls).toEqual([]);
  });

  it("rejects with the refusal of core unchanged", async () => {
    const { port: p } = port(() => {
      throw new Error("surface room does not own session s-1");
    });
    await expect(sessionInput(p, "s-1")("x")).rejects.toThrow("surface room does not own session s-1");
  });
});

describe("sessionRead", () => {
  it("reads the owned session with core.session.read and returns the reply unchanged", async () => {
    const reply = { text: "prompt> " };
    const { calls, port: p } = port(() => reply);
    await expect(sessionRead(p, "s-1")).resolves.toBe(reply);
    expect(calls).toEqual([["core.session.read", { session: "s-1" }]]);
  });

  it("refuses a session that is not a non-empty text, and reads nothing", () => {
    const { calls, port: p } = port();
    expect(() => sessionRead(p, "")).toThrow("session must be a non-empty text");
    expect(calls).toEqual([]);
  });
});
