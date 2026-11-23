// The question of a blocked member (docs/spec/room.md#questions). A program that stops at a question of its own, such as the
// folder-trust prompt of Claude Code, reports `blocked` in core.sessions. The room reads the screen of the session with
// core.session.read, the owner read of core, and shows the question under the conversation; its answer button makes the tab that
// shows the session active with core.layout.select, so the person answers in the program itself. The room types nothing into a
// question: core publishes no event when the screen of a session changes, so a copy of the choices in the room could show a state
// that the program no longer has.
import { shownByOf, type SessionCommandPort } from "./session-channel";

// The rows of a screen from the first to the last row with text, each without its trailing spaces.
export function questionRows(rows: readonly string[]): string[] {
  const trimmed = rows.map((row) => row.replace(/\s+$/u, ""));
  const first = trimmed.findIndex((row) => row !== "");
  if (first === -1) return [];
  let last = trimmed.length - 1;
  while (trimmed[last] === "") last -= 1;
  return trimmed.slice(first, last + 1);
}

// Reads the screen of the session and returns the rows of its question.
export async function readQuestion(port: SessionCommandPort, session: string): Promise<string[]> {
  const reply = await port.commands.execute("core.session.read", { session });
  const rows = reply?.rows;
  if (!Array.isArray(rows) || rows.some((row: unknown) => typeof row !== "string")) {
    throw new Error(`core.session.read rows of ${session} are not a list of texts`);
  }
  return questionRows(rows);
}

// Makes the tab that shows the session of the member active; a session that no tab shows is refused.
export async function showMember(
  port: SessionCommandPort,
  sessions: unknown,
  member: string,
  session: string,
): Promise<{ member: string; tab: string }> {
  const tab = shownByOf(sessions, session);
  if (tab === null) throw new Error(`member ${member}: no tab shows its session ${session}`);
  await port.commands.execute("core.layout.select", { tab });
  return { member, tab };
}
