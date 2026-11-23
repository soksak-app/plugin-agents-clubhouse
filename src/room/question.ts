// The question of a blocked member (docs/spec/room.md#questions). A program that stops at a question of its own, such as the
// folder-trust prompt of Claude Code, reports `blocked` in core.sessions. The room reads the screen of the session with
// core.session.read, the owner read of core, and shows the question under the conversation; its answer button makes the tab that
// shows the session active with core.layout.select. A question with a cursor list also shows its choices as buttons; a choice reads
// the screen again at that moment and types the keys only when the screen still shows it, because core publishes no event when the
// screen of a session changes (C112).
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

// The cursor marks of the selection lists of Claude Code (❯) and Codex (›), and the `>` of other programs.
const CURSOR = /^(\s*)[❯›>](\s+)(\S.*)$/u;

// The choices of a cursor list: the row of the cursor and the rows around it whose text starts in the same column after spaces only.
export function questionChoices(rows: readonly string[]): { index: number; text: string; current: boolean }[] {
  const at = rows.findIndex((row) => CURSOR.test(row));
  if (at === -1) return [];
  const match = CURSOR.exec(rows[at]!)!;
  const column = match[1]!.length + 1 + match[2]!.length;
  const option = (row: string | undefined): boolean =>
    row !== undefined && row.length > column && /^\s*$/u.test(row.slice(0, column)) && /\S/u.test(row[column]!);
  let first = at;
  while (option(rows[first - 1])) first -= 1;
  let last = at;
  while (option(rows[last + 1])) last += 1;
  return rows.slice(first, last + 1).map((row, index) => ({ index, text: row.slice(column).trim(), current: first + index === at }));
}

// Selects the choice in the question of the session: it reads the screen again, refuses a choice that the screen no longer shows,
// and types the arrow keys from the cursor to the choice and Enter with core.session.input.
export async function answerQuestion(
  port: SessionCommandPort,
  member: string,
  session: string,
  choice: string,
): Promise<{ member: string; choice: string }> {
  const choices = questionChoices(await readQuestion(port, session));
  const target = choices.find((one) => one.text === choice);
  const current = choices.find((one) => one.current);
  if (target === undefined || current === undefined) {
    throw new Error(`member ${member}: the question of session ${session} no longer shows the choice ${choice}`);
  }
  const steps = target.index - current.index;
  const text = (steps > 0 ? "\u001b[B".repeat(steps) : "\u001b[A".repeat(-steps)) + "\r";
  await port.commands.execute("core.session.input", { session, text });
  return { member, choice };
}
