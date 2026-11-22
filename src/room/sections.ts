// The sections of an answer (docs/spec/room.md#sections). A line that starts with `@<name>:`, `<name>` being the name or the identifier
// of a member or `owner` compared without case by the mention rules, or `@all:` (everyone), starts the section for that addressee; the section holds
// the text up to the next such line. Text before the first section belongs to `all`. An answer without such a line has no sections. The
// text of the answer stays unchanged in the record; a section `@<name>:` is a mention of that member.

export interface AnswerSection {
  // `owner`, `all` or the identifier of a member.
  to: string;
  text: string;
}

const HEADER = /^@([\p{L}\p{N}_.-]+):[ \t]?(.*)$/u;

export function answerSections(text: string, members: { id: string; name: string }[]): AnswerSection[] {
  const addressee = (word: string): string | null => {
    const lower = word.replace(/\.+$/, "").toLowerCase();
    if (lower === "all" || lower === "owner") return lower;
    return members.find((member) => member.name.toLowerCase() === lower || member.id.toLowerCase() === lower)?.id ?? null;
  };
  const sections: AnswerSection[] = [];
  let current: { to: string; lines: string[] } | null = null;
  const before: string[] = [];
  const flush = (): void => {
    if (current) sections.push({ to: current.to, text: current.lines.join("\n").trim() });
  };
  for (const line of text.split(/\r\n|\r|\n/)) {
    const match = HEADER.exec(line);
    const to = match ? addressee(match[1]) : null;
    if (match && to !== null) {
      flush();
      current = { to, lines: [match[2]] };
    } else if (current) current.lines.push(line);
    else before.push(line);
  }
  flush();
  if (sections.length === 0) return [];
  const lead = before.join("\n").trim();
  return lead === "" ? sections : [{ to: "all", text: lead }, ...sections];
}
