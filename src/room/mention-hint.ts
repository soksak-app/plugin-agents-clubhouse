// The mention hint of the composer (C102, docs/spec/room.md#mention-hint). While the word before the caret starts with `@`, at the start
// of the text or after a space, the composer lists `all` and the names of the members of the room that start with the rest of the word,
// compared without case; a choice replaces the word with `@<name> `.

// The `@` word that ends at the caret: its start and its text after `@`, or null.
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([^\s@]*)$/u.exec(before);
  if (match === null) return null;
  return { start: before.length - match[2]!.length - 1, query: match[2]! };
}

// `all` and the names of the members that start with the query, in that order.
export function mentionCandidates(members: readonly { id: string; name: string }[], query: string): string[] {
  const lower = query.toLowerCase();
  return ["all", ...members.map((member) => member.name)].filter((name) => name.toLowerCase().startsWith(lower));
}

// The text with the `@` word from start to the caret replaced by `@<name> `, and the caret after it.
export function insertMention(text: string, caret: number, start: number, name: string): { text: string; caret: number } {
  const mention = `@${name} `;
  return { text: text.slice(0, start) + mention + text.slice(caret), caret: start + mention.length };
}
