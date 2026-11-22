// Member message relay (C5) against the declared terminal contract: terminal.submit sends the text, terminal.program and
// terminal.state report the turn. The port double below only stores the values that the terminal declares and delivers
// them in order; it has the declared shapes of the status values and the command results.
import { describe, it, expect } from "vitest";
import {
  relayMemberMessage,
  type ProgramRecordState,
  type TerminalPort,
  type TerminalSnapshot,
  type TerminalState,
} from "./relay";

function createTerminalPort(initial: TerminalSnapshot, submitError?: Error) {
  let current = initial;
  const listeners = new Set<(snapshot: TerminalSnapshot) => void>();
  const submitted: string[] = [];
  const port: TerminalPort = {
    async submit(text) {
      if (submitError) throw submitError;
      submitted.push(text);
    },
    snapshot: () => current,
    watch(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    port,
    submitted,
    listeners,
    // A change event of terminal.program or terminal.state: the whole new value, as the status delivers it.
    emit(next: Partial<TerminalSnapshot>) {
      current = { ...current, ...next };
      for (const listener of [...listeners]) listener(current);
    },
  };
}

const running = (sequence = 1) => ({ state: "running" as const, source: "osc133" as const, sequence, exit: null });
const quiet = { records: [], notice: false, sequence: 0 };
const rec = (id: string, state: ProgramRecordState) => ({ id, state, kind: null, progress: null, app: "claude", title: "", msg: "" });

function start(program: TerminalSnapshot["program"], state: TerminalState = running()) {
  return createTerminalPort({ program, state } as TerminalSnapshot);
}

describe("relayMemberMessage — refuses a send that could answer a wait", () => {
  it("refuses while a record is blocked, and submits nothing", async () => {
    const t = start({ records: [rec("root", "blocked")], notice: false, sequence: 4 });
    await expect(relayMemberMessage(t.port, "hello")).rejects.toThrow("member waits for an answer");
    expect(t.submitted).toEqual([]);
  });
  it("refuses while the notice is set (the member called the person)", async () => {
    const t = start({ records: [rec("root", "idle")], notice: true, sequence: 4 });
    await expect(relayMemberMessage(t.port, "hello")).rejects.toThrow("member waits for an answer");
    expect(t.submitted).toEqual([]);
  });
  it("refuses a running command without records, whose wait is unknown", async () => {
    const t = start(quiet);
    await expect(relayMemberMessage(t.port, "hello")).rejects.toThrow("member waits for an answer");
    expect(t.submitted).toEqual([]);
  });
  it("refuses when the member is not running (the input would reach the shell)", async () => {
    const t = start({ records: [rec("root", "idle")], notice: false, sequence: 4 }, { state: "idle", source: "osc133", sequence: 5, exit: 0 });
    await expect(relayMemberMessage(t.port, "hello")).rejects.toThrow("member session is not running: idle");
    expect(t.submitted).toEqual([]);
  });
});

describe("relayMemberMessage — sends and takes the end of the turn", () => {
  it("submits the text and resolves when the records of the turn are done", async () => {
    const t = start({ records: [rec("root", "idle")], notice: false, sequence: 3 });
    const sent = relayMemberMessage(t.port, "review the diff");
    expect(t.submitted).toEqual(["review the diff"]);
    let settled = false;
    void sent.then(() => (settled = true));
    t.emit({ program: { records: [rec("root", "working")], notice: false, sequence: 4 } });
    await Promise.resolve();
    expect(settled).toBe(false);
    t.emit({ program: { records: [rec("root", "done")], notice: false, sequence: 5 } });
    await expect(sent).resolves.toBeUndefined();
    expect(t.listeners.size).toBe(0);
  });
  it("does not take a stale done record as the end of the turn", async () => {
    const t = start({ records: [rec("root", "done")], notice: false, sequence: 3 });
    let settled = false;
    const sent = relayMemberMessage(t.port, "next").then(() => (settled = true));
    t.emit({ program: { records: [rec("root", "done")], notice: true, sequence: 4 } });
    await Promise.resolve();
    expect(settled).toBe(false);
    t.emit({ program: { records: [rec("root", "working")], notice: false, sequence: 5 } });
    t.emit({ program: { records: [rec("root", "idle")], notice: false, sequence: 6 } });
    await sent;
    expect(settled).toBe(true);
  });
});

describe("relayMemberMessage — errors during the turn reject the send", () => {
  it("rejects with a blocked record that appears during the turn", async () => {
    const t = start({ records: [rec("root", "idle")], notice: false, sequence: 3 });
    const sent = relayMemberMessage(t.port, "deploy");
    t.emit({ program: { records: [rec("root", "blocked")], notice: false, sequence: 4 } });
    await expect(sent).rejects.toThrow("member waits for an answer");
  });
  it("rejects with an error record that appears during the turn", async () => {
    const t = start({ records: [rec("root", "working")], notice: false, sequence: 3 });
    const sent = relayMemberMessage(t.port, "build");
    t.emit({ program: { records: [rec("root", "error")], notice: false, sequence: 4 } });
    await expect(sent).rejects.toThrow("member reported an error");
  });
  it("rejects when the member session ends during the turn", async () => {
    const t = start({ records: [rec("root", "working")], notice: false, sequence: 3 });
    const sent = relayMemberMessage(t.port, "build");
    t.emit({ state: { state: "idle", source: "osc133", sequence: 2, exit: 0 } });
    await expect(sent).rejects.toThrow("member session is not running: idle");
  });
  it("rejects with the text that the terminal refused, such as a line break", async () => {
    const t = createTerminalPort(
      { program: { records: [rec("root", "idle")], notice: false, sequence: 3 }, state: running() },
      new Error("terminal.submit refuses text that contains CR or LF"),
    );
    await expect(relayMemberMessage(t.port, "a\nb")).rejects.toThrow("terminal.submit refuses text that contains CR or LF");
    expect(t.listeners.size).toBe(0);
  });
  it("rejects when the signal aborts, and stops watching", async () => {
    const t = start({ records: [rec("root", "working")], notice: false, sequence: 3 });
    const controller = new AbortController();
    const sent = relayMemberMessage(t.port, "long task", { signal: controller.signal });
    controller.abort();
    await expect(sent).rejects.toThrow("member relay aborted");
    expect(t.listeners.size).toBe(0);
  });
});
