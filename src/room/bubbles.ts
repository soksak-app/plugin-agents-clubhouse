// The view of the conversation (docs/spec/room.md#conversation-view). The room draws each record entry as a bubble: the owner on the
// right, a member on the left with the color of its place in the roster, so the color of a member stays the same while the roster keeps
// its order. A line of the room is a centered system line. A report, a claim or a release of a member is a compact note under the answer
// bubble of the turn in which the member gave it, or under its last bubble when no answer follows. A divider with the round number goes
// before the first answer after a line of the owner and before each answer of a member that already answered since that line.
import type { AnswerSection } from "./sections";
import type { StatusEntry } from "./conversation-status";

export type NoteKind = "report" | "claim" | "release";

export type ViewItem =
  | { kind: "divider"; round: number }
  | { kind: "system"; text: string; index: number }
  | {
      kind: "bubble";
      // The index of the record entry.
      index: number;
      side: "right" | "left";
      speaker: string;
      // The place of the member in the roster, null for the owner and for a speaker outside the roster.
      color: number | null;
      text: string;
      sections: AnswerSection[];
      elapsedMs: number | null;
      notes: { kind: NoteKind; text: string }[];
    };

type Bubble = Extract<ViewItem, { kind: "bubble" }>;
const NOTE = /^\((report|claim|release)\) ([\s\S]*)$/;

export function conversationView(entries: readonly StatusEntry[], roster: readonly string[]): ViewItem[] {
  const items: ViewItem[] = [];
  const last = new Map<string, Bubble>();
  const held = new Map<string, Bubble["notes"]>();
  let round = 0;
  let spoken = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    if (entry.speaker === "clubhouse") {
      items.push({ kind: "system", text: entry.text, index });
      continue;
    }
    if (entry.speaker === "owner") {
      items.push({ kind: "bubble", index, side: "right", speaker: "owner", color: null, text: entry.text, sections: entry.sections, elapsedMs: null, notes: [] });
      round = 0;
      spoken = new Set();
      continue;
    }
    const note = NOTE.exec(entry.text);
    if (note) {
      const notes = held.get(entry.speaker) ?? [];
      notes.push({ kind: note[1] as NoteKind, text: note[2] });
      held.set(entry.speaker, notes);
      continue;
    }
    if (round === 0 || spoken.has(entry.speaker)) {
      round += 1;
      spoken = new Set();
      items.push({ kind: "divider", round });
    }
    spoken.add(entry.speaker);
    const place = roster.indexOf(entry.speaker);
    const bubble: Bubble = {
      kind: "bubble",
      index,
      side: "left",
      speaker: entry.speaker,
      color: place < 0 ? null : place,
      text: entry.text,
      sections: entry.sections,
      elapsedMs: entry.elapsedMs,
      notes: held.get(entry.speaker) ?? [],
    };
    held.delete(entry.speaker);
    last.set(entry.speaker, bubble);
    items.push(bubble);
  }
  // Notes after the last answer of a member, such as the release at the close of its turn, go under that answer.
  for (const [speaker, notes] of held) {
    const bubble = last.get(speaker);
    if (bubble) bubble.notes.push(...notes);
    else for (const note of notes) items.push({ kind: "system", text: `${speaker} (${note.kind}) ${note.text}`, index: entries.length - 1 });
  }
  return items;
}

// The time of a turn in seconds with one decimal.
export function elapsedLabel(ms: number, lang: "en" | "ko"): string {
  const seconds = (ms / 1000).toFixed(1);
  return lang === "ko" ? `${seconds}초` : `${seconds} s`;
}
