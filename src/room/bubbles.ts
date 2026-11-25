// The view of the conversation (docs/spec/room.md#conversation-view). The room draws each record entry as a bubble: the owner on the
// right, a member on the left with the color of its place in the group, so the color of a member stays the same while the group keeps
// its order. A line of the room is a centered system line. A claim or a report of a member comes in its open turn before the answer of
// that turn: it is a compact note at its place in the record until that answer arrives, and then under that answer. A release follows
// the answer at the close of a turn, so it goes under the last answer of its member. A divider with the round number goes
// before the first answer after a line of the owner and before each answer of a member that already answered since that line.
import type { AnswerSection } from "./sections";
import type { StatusEntry } from "./conversation-status";

export type NoteKind = "report" | "claim" | "release";

export type ViewItem =
  | { kind: "divider"; round: number }
  | { kind: "system"; text: string; index: number }
  // The claims and reports of the open turn of a member whose answer has not arrived, at the place of the first of them in the record.
  | { kind: "notes"; index: number; speaker: string; color: number | null; notes: { kind: NoteKind; text: string }[] }
  | {
      kind: "bubble";
      // The index of the record entry.
      index: number;
      side: "right" | "left";
      speaker: string;
      // The place of the member in the group, null for the owner and for a speaker outside the group.
      color: number | null;
      text: string;
      sections: AnswerSection[];
      elapsedMs: number | null;
      notes: { kind: NoteKind; text: string }[];
    };

type Bubble = Extract<ViewItem, { kind: "bubble" }>;
type Notes = Extract<ViewItem, { kind: "notes" }>;
const NOTE = /^\((report|claim|release)\) ([\s\S]*)$/;

export function conversationView(entries: readonly StatusEntry[], order: readonly string[]): ViewItem[] {
  const items: ViewItem[] = [];
  const last = new Map<string, Bubble>();
  // The notes item of the open turn of each member, removed from the items when the answer of that turn takes its notes.
  const held = new Map<string, Notes>();
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
    const place = order.indexOf(entry.speaker);
    const note = NOTE.exec(entry.text);
    if (note) {
      const kind = note[1] as NoteKind;
      const answer = last.get(entry.speaker);
      if (kind === "release" && answer !== undefined && !held.has(entry.speaker)) {
        answer.notes.push({ kind, text: note[2] });
        continue;
      }
      let open = held.get(entry.speaker);
      if (open === undefined) {
        open = { kind: "notes", index, speaker: entry.speaker, color: place < 0 ? null : place, notes: [] };
        held.set(entry.speaker, open);
        items.push(open);
      }
      open.notes.push({ kind, text: note[2] });
      continue;
    }
    if (round === 0 || spoken.has(entry.speaker)) {
      round += 1;
      spoken = new Set();
      items.push({ kind: "divider", round });
    }
    spoken.add(entry.speaker);
    const open = held.get(entry.speaker);
    if (open !== undefined) items.splice(items.indexOf(open), 1);
    const bubble: Bubble = {
      kind: "bubble",
      index,
      side: "left",
      speaker: entry.speaker,
      color: place < 0 ? null : place,
      text: entry.text,
      sections: entry.sections,
      elapsedMs: entry.elapsedMs,
      notes: open?.notes ?? [],
    };
    held.delete(entry.speaker);
    last.set(entry.speaker, bubble);
    items.push(bubble);
  }
  return items;
}

// The time of a turn in seconds with one decimal.
export function elapsedLabel(ms: number, lang: "en" | "ko"): string {
  const seconds = (ms / 1000).toFixed(1);
  return lang === "ko" ? `${seconds}초` : `${seconds} s`;
}

// The unit of the label: elapsedLabel shows tenths of a second through toFixed, so the label changes once per 100 ms near each 50 ms
// mark; the binary value of a mark such as 0.15 can round down, so the change is found from the label itself.
const LABEL_UNIT_MS = 100;

// The whole milliseconds from `ms` to the next change of elapsedLabel, always positive (docs/spec/room.md#timing).
export function nextLabelChange(ms: number): number {
  const label = elapsedLabel(ms, "en");
  const half = LABEL_UNIT_MS / 2;
  const phase = (((ms - half) % LABEL_UNIT_MS) + LABEL_UNIT_MS) % LABEL_UNIT_MS;
  // Two milliseconds before the nominal mark, so a mark that rounds early is not passed.
  let next = Math.max(ms + 1, ms + LABEL_UNIT_MS - phase - 2);
  while (elapsedLabel(next, "en") === label) next += 1;
  return next - ms;
}
