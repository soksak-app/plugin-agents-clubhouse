// The mentions of a room message (docs/spec/room.md#mentions). A mention is `@` and the name or the identifier of a member, compared
// without case, at the start of the message or after a space; `-`, `_` and `.` belong to the mention and other punctuation ends it.

const MENTION = /(?:^|\s)@([\p{L}\p{N}_.-]+)/gu;

export function mentionedMembers<T extends { id: string; name: string }>(text: string, members: T[]): T[] {
  const found: T[] = [];
  for (const match of text.matchAll(MENTION)) {
    // A trailing `.` ends a sentence, not a name.
    const word = match[1].replace(/\.+$/, "").toLowerCase();
    const member = members.find((entry) => entry.name.toLowerCase() === word || entry.id.toLowerCase() === word);
    if (member && !found.includes(member)) found.push(member);
  }
  return found;
}
