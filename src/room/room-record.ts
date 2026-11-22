// The room record (docs/spec/room.md#room-record): the lines of the owner and the answers of the members in the order in which the room
// took them, and for each member session the number of record lines that the room delivered to it. At the start of each turn a member
// receives every record line that it has not received, so every member reads the whole record.

export interface RecordLine {
  // `owner` or the identifier of a member.
  speaker: string;
  text: string;
}

export interface PendingLines {
  // The record lines that the session has not received, without its own lines, each as `[@<speaker>] <text>` joined with " | ".
  text: string;
  // The speakers of those lines in the order of their first line.
  speakers: string[];
  // The length of the record when the text was built: the delivered number after an accepted submit.
  count: number;
}

export interface RoomRecord {
  readonly lines: readonly RecordLine[];
  // The delivered number of each session, as the tab state keeps it.
  delivered(): Record<string, number>;
  append(speaker: string, text: string): void;
  // The lines that `session` of the member `self` has not received; null when there is none.
  pending(session: string, self: string): PendingLines | null;
  markDelivered(session: string, count: number): void;
  // Removes the line at `index` when it is the last line of the record, and lowers each delivered number to the new length. Returns
  // whether it removed the line.
  withdrawLast(index: number): boolean;
}

const oneLine = (text: string): string => text.replace(/\r\n|\r|\n/g, " ");

// `nameOf` gives the label of a speaker: `owner` for the owner and the roster name of a member. `changed` runs after each change.
export function createRoomRecord(
  lines: RecordLine[],
  delivered: Record<string, number>,
  nameOf: (speaker: string) => string,
  changed: () => void,
): RoomRecord {
  const counts = new Map(Object.entries(delivered));
  return {
    lines,
    delivered: () => Object.fromEntries(counts),
    append(speaker, text) {
      lines.push({ speaker, text });
      changed();
    },
    pending(session, self) {
      const from = counts.get(session) ?? 0;
      const own = lines.slice(from).filter((line) => line.speaker !== self);
      if (own.length === 0) return null;
      return {
        text: own.map((line) => `[@${nameOf(line.speaker)}] ${oneLine(line.text)}`).join(" | "),
        speakers: [...new Set(own.map((line) => line.speaker))],
        count: lines.length,
      };
    },
    markDelivered(session, count) {
      counts.set(session, count);
      changed();
    },
    withdrawLast(index) {
      if (index !== lines.length - 1) return false;
      lines.pop();
      for (const [session, count] of counts) if (count > lines.length) counts.set(session, lines.length);
      changed();
      return true;
    },
  };
}

// Runs the relay of the last line of the owner. A relay that fails before any answer is in the record withdraws that line, so the
// record holds no message that no member answered; a relay that fails after an answer keeps it (docs/spec/room.md#room-record).
export async function withdrawnOnFailure<T>(record: RoomRecord, relay: () => Promise<T>): Promise<T> {
  const index = record.lines.length - 1;
  try {
    return await relay();
  } catch (error) {
    record.withdrawLast(index);
    throw error;
  }
}
