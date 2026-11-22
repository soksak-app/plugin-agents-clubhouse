// The member message relay (C5) against the owner commands of an owned session: the line goes out with core.session.submit, and the
// turn ends when the program state of the session, from core.sessions, goes working and back to idle. The port double records the
// submits and plays the program state changes that the test gives it; no module is mocked.
import { describe, expect, it } from "vitest";
import { relayMemberMessage, type SessionRelayPort, type ProgramState } from "./relay";

// A port whose program state the test drives: set changes the state and calls the listeners, submit records the line.
function sessionPort(initial: ProgramState | null, onSubmit: (port: { set(state: ProgramState | null): void }) => Promise<void> = async () => {}) {
  let state = initial;
  const listeners = new Set<(state: ProgramState | null) => void>();
  const submitted: string[] = [];
  const set = (next: ProgramState | null) => {
    state = next;
    for (const listener of listeners) listener(next);
  };
  const port: SessionRelayPort = {
    submit: async (text) => {
      submitted.push(text);
      await onSubmit({ set });
    },
    program: () => state,
    watch: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  return { port, submitted, set };
}

describe("relayMemberMessage", () => {
  it("submits the line and resolves when the program goes working and back to idle", async () => {
    const { port, submitted, set } = sessionPort("idle", async ({ set }) => {
      set("working");
    });
    let done = false;
    const relay = relayMemberMessage(port, "summarize").then(() => (done = true));
    await new Promise((r) => setTimeout(r, 0));
    expect(done).toBe(false);
    set("idle");
    await relay;
    expect(submitted).toEqual(["summarize"]);
  });

  it("refuses a send while the program is working, and submits nothing", async () => {
    const { port, submitted } = sessionPort("working");
    await expect(relayMemberMessage(port, "x")).rejects.toThrow("member is working");
    expect(submitted).toEqual([]);
  });

  it("refuses a send while the program is blocked, and submits nothing", async () => {
    const { port, submitted } = sessionPort("blocked");
    await expect(relayMemberMessage(port, "x")).rejects.toThrow("member waits for an answer");
    expect(submitted).toEqual([]);
  });

  it("refuses a send when the session has no program state", async () => {
    const { port, submitted } = sessionPort(null);
    await expect(relayMemberMessage(port, "x")).rejects.toThrow("member session has no program state");
    expect(submitted).toEqual([]);
  });

  it("rejects when the program turns blocked during the turn", async () => {
    const { port, set } = sessionPort("idle", async ({ set }) => set("working"));
    const relay = relayMemberMessage(port, "x");
    await new Promise((r) => setTimeout(r, 0));
    set("blocked");
    await expect(relay).rejects.toThrow("member waits for an answer");
  });

  it("rejects with the refusal of core when the submit is refused, ", async () => {
    const { port } = sessionPort("idle");
    const refusing: SessionRelayPort = { ...port, submit: async () => { throw new Error("core.session.submit text must not contain CR or LF"); } };
    await expect(relayMemberMessage(refusing, "a\nb")).rejects.toThrow("core.session.submit text must not contain CR or LF");
  });

  it("stops at an abort signal and rejects", async () => {
    const { port } = sessionPort("idle", async () => {});
    const controller = new AbortController();
    const relay = relayMemberMessage(port, "x", { signal: controller.signal });
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();
    await expect(relay).rejects.toThrow("member relay aborted");
  });
});
