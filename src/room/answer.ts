// The answer of a member (docs/spec/room.md#answer). core.session.read gives only the visible rows of the screen as text, and core
// declares no channel that carries the reply text of a program, so the room takes the answer from the rows by the rule of the spec:
// the last reply block, which starts at a row with the reply marker and continues with the rows indented by two spaces. Rows that
// break the block, which a program and a terminal that laid out the screen at different widths leave, are refused, not repaired.

const MARKER = "⏺ ";
const INDENT = "  ";

// Returns the text of the last reply block of the rows, or throws an error that names the screen row that breaks the rule.
export function answerText(rows: string[]): string {
  const start = rows.map((row) => row.startsWith(MARKER)).lastIndexOf(true);
  if (start < 0) throw new Error("the screen shows no reply row: no row starts with the reply marker");
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
    throw new Error(`the reply rows are broken at screen row ${index}: ${JSON.stringify(row)}`);
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}
