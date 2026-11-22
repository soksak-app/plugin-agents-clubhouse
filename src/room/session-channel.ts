// The owner side of an owned session (C5, core docs/spec/plugins.md#owned-sessions). The room is the owner surface of its member
// sessions, so it sends input and reads the session through the owner commands core.session.input {session, text} and
// core.session.read {session}, which core relays to the sidecar of the session (core F1062-7, not yet merged). The room names no
// plugin and no sidecar here: the session identifier comes from the summon relation (C3). The reply of core.session.read is
// passed through unchanged; its shape is not declared yet, so no caller reads a field of it.

export interface SessionCommandPort {
  commands: { execute(name: string, params: Record<string, unknown>): Promise<any> };
}

function checkSession(session: string): void {
  if (typeof session !== "string" || session === "") throw new Error("session must be a non-empty text");
}

// Returns the function that sends text to the session. A refusal of core rejects with its text, and nothing is sent for an invalid
// session or text.
export function sessionInput(port: SessionCommandPort, session: string): (text: string) => Promise<void> {
  checkSession(session);
  return async (text: string) => {
    if (typeof text !== "string") throw new Error("input text must be a string");
    await port.commands.execute("core.session.input", { session, text });
  };
}

// Reads the owned session through core.session.read and returns its reply unchanged.
export function sessionRead(port: SessionCommandPort, session: string): Promise<unknown> {
  checkSession(session);
  return port.commands.execute("core.session.read", { session });
}
