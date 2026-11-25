// The mood of a message of the owner (C150, docs/spec/room.md#mood): an optional choice of the composer whose emoji the room puts
// before the text, so each member reads the feeling of the owner with the message.
export const MOODS = [
  { id: "glad", emoji: "\u{1F60A}" },
  { id: "fine", emoji: "\u{1F642}" },
  { id: "worried", emoji: "\u{1F61F}" },
  { id: "upset", emoji: "\u{1F620}" },
  { id: "thankful", emoji: "\u{1F64F}" },
  { id: "excited", emoji: "\u{1F929}" },
] as const;

export type Mood = (typeof MOODS)[number]["id"];

// moodText returns the text of a message with the emoji of mood before it, and the text alone for an absent or empty mood. Another
// value is refused with its value.
export function moodText(mood: unknown, text: string): string {
  if (mood === undefined || mood === "") return text;
  const chosen = MOODS.find((one) => one.id === mood);
  if (chosen === undefined) {
    throw new Error(`mood must be one of ${MOODS.slice(0, -1).map((one) => one.id).join(", ")}, ${MOODS[MOODS.length - 1].id} or empty, got ${JSON.stringify(mood)}`);
  }
  return `${chosen.emoji} ${text}`;
}
