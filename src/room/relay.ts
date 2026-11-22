// Member message relay (C5). A room message reaches a member session as one submitted line (core.session.submit). The turn ends
// when the program state of the session goes working and then idle again (core docs/spec/plugins.md#owned-sessions, the program
// state of core.sessions). A member that is working, blocked or has no state gets no line, because the line would answer a question
// or queue behind a running turn. A turn whose program turns blocked fails. A turn that never reports working does not end: the
// relay waits until its abort signal stops it, because an idle state without a working state proves no turn.

import type { ProgramState } from "./session-channel";

export type { ProgramState };

export interface SessionRelayPort {
  // Submits the line to the member session; resolves when core accepted it and rejects with the refusal of core.
  submit(text: string): Promise<void>;
  // The current program state of the member session, or null while the sidecar has reported none.
  program(): ProgramState | null;
  // Calls the listener with each new program state of the session, until the returned function is called.
  watch(listener: (state: ProgramState | null) => void): () => void;
}

export interface RelayOptions {
  signal?: AbortSignal;
}

// Sends one room message to the member and resolves when the member's turn ends. Each refusal is an explicit error, and nothing is
// submitted for a refused send.
export function relayMemberMessage(port: SessionRelayPort, text: string, options: RelayOptions = {}): Promise<void> {
  const refusal = refuseSend(port.program());
  if (refusal !== null) return Promise.reject(new Error(refusal));
  if (options.signal?.aborted) return Promise.reject(new Error("member relay aborted"));

  return new Promise<void>((resolve, reject) => {
    let working = false;
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
    stop = port.watch((state) => {
      if (settled) return;
      if (state === null) return finish(new Error("member session has no program state"));
      if (state === "blocked") return finish(new Error("member waits for an answer: its program is blocked"));
      if (state === "working") {
        working = true;
        return;
      }
      if (working) finish();
    });
    port.submit(text).catch((error: unknown) => finish(error instanceof Error ? error : new Error(String(error))));
  });
}

// The reason that a member must not receive a line now, or null when its program is idle.
function refuseSend(state: ProgramState | null): string | null {
  if (state === null) return "member session has no program state";
  if (state === "working") return "member is working: its turn has not ended";
  if (state === "blocked") return "member waits for an answer: its program is blocked";
  return null;
}
