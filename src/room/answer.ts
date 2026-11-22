// The answer of a member (docs/spec/room.md#answer). Core gives the owner of a session the rows of its screen and its retained rows by
// absolute line number, and declares no channel that carries the reply text of a program, so the room finds the submitted line on the
// screen by the prompt marker, reads the rows after it, and takes the answer from the rows of the turn by the rule of the spec: the
// last reply block before the next prompt, which starts at a row with the reply marker and continues with the rows indented by two
// spaces. Rows that break the block, which a program and a terminal that laid out the rows at different widths leave, are refused,
// not repaired.

const PROMPT = "❯";
const MARKER = "⏺ ";
const INDENT = "  ";

// Returns the absolute line number of the last screen row that shows the submitted text after the prompt marker. The first row of a
// line that the terminal wrapped holds the start of the text, so the text must begin with the rest of the row.
export function submittedLine(screen: { from: number; rows: string[] }, text: string): number {
  const shows = (row: string): boolean => {
    if (!row.startsWith(`${PROMPT} `)) return false;
    const rest = row.slice(PROMPT.length + 1).trimEnd();
    return rest !== "" && text.startsWith(rest);
  };
  const index = screen.rows.map(shows).lastIndexOf(true);
  if (index < 0) throw new Error("the screen shows no submitted line: no row starts with the prompt marker and the submitted text");
  return screen.from + index;
}

// Returns the text of the last reply block of the rows after the submitted line up to the next prompt, or throws an error that names
// the turn row that breaks the rule.
export function turnAnswer(rowsAfterLine: string[]): string {
  const end = rowsAfterLine.findIndex((row) => row.startsWith(PROMPT));
  if (end < 0) throw new Error("the rows of the turn show no prompt row after the submitted line");
  const rows = rowsAfterLine.slice(0, end);
  const start = rows.map((row) => row.startsWith(MARKER)).lastIndexOf(true);
  if (start < 0) throw new Error("the rows of the turn show no reply row: no row starts with the reply marker");
  const lines = [rows[start].slice(MARKER.length).trimEnd()];
  let blank = false;
  for (let index = start + 1; index < rows.length; index += 1) {
    const row = rows[index].trimEnd();
    if (row === "") {
      blank = true;
      lines.push("");
      continue;
    }
    if (row.startsWith(INDENT)) {
      blank = false;
      lines.push(row.slice(INDENT.length));
      continue;
    }
    if (blank) break;
    throw new Error(`the reply rows are broken at turn row ${index}: ${JSON.stringify(row)}`);
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}
