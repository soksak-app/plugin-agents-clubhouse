// Member message relay (C5). A room message reaches a member's terminal session as input of the declared terminal.submit
// command. The end of the member's turn comes from the declared terminal.program status: the turn ends when its records are
// all done or idle and differ from the last value that the relay saw. A member that waits (a blocked record, a notice, or a
// command without records, whose wait is unknown) or that is not running gets no input, because the input would answer a
// prompt or run in the shell. The relay reads no screen, no sidecar and no session file of a CLI.
//
// The port is the declared contract of the terminal (core docs/spec/terminal-state.md#plugin-program-status and
// #states-of-a-running-terminal, and the terminal plugin's terminal.submit, terminal.program and terminal.state). The room
// reaches a terminal session only through its owned session (C3), so no caller uses this module yet.

export type ProgramRecordState = "idle" | "working" | "blocked" | "done" | "error";

export interface ProgramRecord {
  id: string;
  state: ProgramRecordState;
}

// The value of terminal.program: the records of the program, its notice and the sequence of its last change.
export interface TerminalProgram {
  records: ProgramRecord[];
  notice: boolean;
  sequence: number;
}

// The value of terminal.state: the state of the shell's command, null before the first mark.
export interface TerminalState {
  state: "idle" | "running" | "exited" | null;
  source: "osc133" | null;
  sequence: number;
  exit: number | null;
}

export interface TerminalSnapshot {
  program: TerminalProgram;
  state: TerminalState;
}

export interface TerminalPort {
  // Runs terminal.submit on the member's terminal surface. It resolves when the terminal answered both inputs and rejects
  // with the terminal's refusal.
  submit(text: string): Promise<void>;
  // The current values of terminal.program and terminal.state.
  snapshot(): TerminalSnapshot;
  // Calls the listener with the values after each change of either status, until the returned function is called.
  watch(listener: (snapshot: TerminalSnapshot) => void): () => void;
}

export interface RelayOptions {
  signal?: AbortSignal;
}

// Sends one room message to the member and resolves when the member's turn ends. Each refusal is an explicit error; nothing
// is submitted for a refused send.
export function relayMemberMessage(port: TerminalPort, text: string, options: RelayOptions = {}): Promise<void> {
  const start = port.snapshot();
  const refusal = refuseSend(start);
  if (refusal !== null) return Promise.reject(new Error(refusal));
  if (options.signal?.aborted) return Promise.reject(new Error("member relay aborted"));

  return new Promise<void>((resolve, reject) => {
    let previous = recordsKey(start.program);
    let settled = false;
    let stop: () => void = () => {};
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      stop();
      options.signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => finish(new Error("member relay aborted"));
    options.signal?.addEventListener("abort", onAbort, { once: true });

    // The watch starts before the submit, so that no change between the two is missed.
    stop = port.watch((snapshot) => {
      if (settled) return;
      if (snapshot.state.state !== "running") {
        finish(new Error(`member session is not running: ${snapshot.state.state ?? "no state"}`));
        return;
      }
      const key = recordsKey(snapshot.program);
      // A value whose records equal the last value is a notice or a sequence change, not a new state of the program.
      if (key === previous) return;
      previous = key;
      const records = snapshot.program.records;
      if (records.some((record) => record.state === "blocked")) {
        finish(new Error("member waits for an answer: a record is blocked"));
        return;
      }
      if (records.some((record) => record.state === "error")) {
        finish(new Error("member reported an error"));
        return;
      }
      if (records.length > 0 && records.every((record) => record.state === "done" || record.state === "idle")) finish();
    });
    port.submit(text).catch((error: unknown) => finish(error instanceof Error ? error : new Error(String(error))));
  });
}

// The reason that a member must not receive input now, or null when the member is running and its wait is known.
function refuseSend(snapshot: TerminalSnapshot): string | null {
  if (snapshot.state.state !== "running") {
    return `member session is not running: ${snapshot.state.state ?? "no state"}`;
  }
  if (snapshot.program.records.some((record) => record.state === "blocked")) {
    return "member waits for an answer: a record is blocked";
  }
  if (snapshot.program.notice) return "member waits for an answer: the member called the person";
  if (snapshot.program.records.length === 0) {
    return "member waits for an answer: its command reports no records, so its wait is unknown";
  }
  return null;
}

function recordsKey(program: TerminalProgram): string {
  return JSON.stringify(program.records);
}
