// The mentions of a room message (docs/spec/room.md#mentions). A mention is `@` and the name or the identifier of a member, or `all`,
// compared without case, at the start of the message or after a space; `-`, `_` and `.` belong to the mention and other punctuation
// ends it. A word that a name prefixes and whose remainder starts with Hangul is that name, because Korean particles attach to it.
// Inline code spans, fenced code blocks and quote lines that start with `>` hold no mention, because they quote text.

const MENTION = /(?:^|\s)@([\p{L}\p{N}_.-]+)/gu;
const HANGUL = /^\p{Script=Hangul}/u;

// The text without inline code spans, fenced code blocks and quote lines.
function mentionText(text: string): string {
  let fenced = false;
  const kept: string[] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || /^\s*>/.test(line)) continue;
    kept.push(line.replace(/`[^`]*`/g, " "));
  }
  return kept.join("\n");
}

// The mentioned words in order: each word without a trailing `.`, in lower case.
function mentionWords(text: string): string[] {
  return [...mentionText(text).matchAll(MENTION)].map((match) => match[1].replace(/\.+$/, "").toLowerCase());
}

// The longest of names that the word equals, or that prefixes the word with a remainder starting with Hangul.
function named(word: string, names: string[]): string | undefined {
  return names
    .filter((name) => word === name || (word.startsWith(name) && HANGUL.test(word.slice(name.length))))
    .sort((a, b) => b.length - a.length)[0];
}

export function mentionsAll(text: string): boolean {
  return mentionWords(text).some((word) => named(word, ["all"]) !== undefined);
}

export function mentionedMembers<T extends { id: string; name: string }>(text: string, members: T[]): T[] {
  const found: T[] = [];
  const names = members.flatMap((member) => [member.name.toLowerCase(), member.id.toLowerCase()]);
  for (const word of mentionWords(text)) {
    const name = named(word, names);
    const member = members.find((entry) => entry.name.toLowerCase() === name || entry.id.toLowerCase() === name);
    if (member && !found.includes(member)) found.push(member);
  }
  return found;
}
