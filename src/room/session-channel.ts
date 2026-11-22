// The owner side of an owned session (C5, core docs/spec/plugins.md#owned-sessions). The room is the owner surface of its member
// sessions. It sends a line with core.session.submit {session, text}, which core pastes and ends with Enter and which refuses CR and
// LF, reads the screen with core.session.read {session} as {rows, cursor}, and reads the program state of a session from its entry
// of core.sessions, where core gives `program` as {state} or null. The room names no plugin and no sidecar: the session identifier
// comes from the summon relation (C3).

export interface SessionCommandPort {
  commands: { execute(name: string, params: Record<string, unknown>): Promise<any> };
}

export type ProgramState = "idle" | "working" | "blocked";

export interface SessionScreen {
  rows: string[];
  cursor: { row: number; column: number };
}

const PROGRAM_STATES: readonly string[] = ["idle", "working", "blocked"];

function checkSession(session: string): void {
  if (typeof session !== "string" || session === "") throw new Error("session must be a non-empty text");
}

// Returns the function that submits a line to the session. A refusal of core rejects with its text; nothing is sent for an invalid
// session or text.
export function sessionSubmit(port: SessionCommandPort, session: string): (text: string) => Promise<void> {
  checkSession(session);
  return async (text: string) => {
    if (typeof text !== "string") throw new Error("submit text must be a string");
    const reply = await port.commands.execute("core.session.submit", { session, text });
    if (reply === null || typeof reply !== "object") throw new Error("core.session.submit reply is not an object");
  };
}

// Reads the screen of the session: the visible rows, top row first, and the cursor position in them.
export async function sessionRead(port: SessionCommandPort, session: string): Promise<SessionScreen> {
  checkSession(session);
  const reply = await port.commands.execute("core.session.read", { session });
  if (!Array.isArray(reply?.rows) || !reply.rows.every((row: unknown) => typeof row === "string")) {
    throw new Error("core.session.read rows must be an array of strings");
  }
  const cursor = reply.cursor;
  const isIndex = (value: unknown) => Number.isInteger(value) && (value as number) >= 0;
  if (cursor === null || typeof cursor !== "object" || !isIndex(cursor.row) || !isIndex(cursor.column)) {
    throw new Error("core.session.read cursor must be zero-based integers");
  }
  return { rows: reply.rows, cursor: { row: cursor.row, column: cursor.column } };
}

// The program state of session in a value of core.sessions, the list of open sessions. A session that the list does not hold is
// refused, and null means that the sidecar has reported no state yet.
export function sessionProgram(sessions: unknown, session: string): ProgramState | null {
  if (!Array.isArray(sessions)) throw new Error("core.sessions is not a list");
  const entry = sessions.find((item) => item?.session === session);
  if (entry === undefined) throw new Error(`session ${session} is not open`);
  if (entry.program === null || entry.program === undefined) return null;
  const state = entry.program?.state;
  if (typeof state !== "string" || !PROGRAM_STATES.includes(state)) {
    throw new Error(`program state ${String(state)} is not idle, working or blocked`);
  }
  return state as ProgramState;
}
