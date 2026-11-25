// The member cards of the header (docs/spec/room.md#header): the initials of a member name and the state of a member. The page draws
// the cards from these values.

export type MemberState = "answering" | "idle" | "none";

// The initials of a name: the first character of its first two words, or its first two characters for a name of one word, in upper
// case. Characters are code points, so a name in Hangul or with an emoji keeps whole characters.
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return "";
  const chars = words.length === 1 ? [...words[0]].slice(0, 2) : [[...words[0]][0], [...words[1]][0]];
  return chars.join("").toUpperCase();
}

// The state of a member: answering while the room waits for its answer, idle while its session is open, and none without an open
// session. The header shows nothing of the login of an account (docs/spec/room.md#header).
export function memberState(open: boolean, waited: boolean): MemberState {
  if (!open) return "none";
  return waited ? "answering" : "idle";
}

