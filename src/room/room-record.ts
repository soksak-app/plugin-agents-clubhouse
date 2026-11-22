// The room record (docs/spec/room.md#room-record): the lines of the owner, the answers of the members and the lines of the room in the
// order in which the room took them, and for each member session the number of record lines that it has received. Each turn line and each
// record line of a session carries the lines from that number to the end of the record, and the number rises only when the answer or the
// acknowledgement of the token of the line arrives, so every member reads the whole record once and in order.

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
  // The length of the record when the text was built: the delivered number after the answer or the acknowledgement of the line.
  count: number;
}

export interface RoomRecord {
  readonly lines: readonly RecordLine[];
  // The delivered number of each session, as the tab state keeps it.
  delivered(): Record<string, number>;
  // The sent number of each session: the record lines that the room submitted to it; a delivered number never exceeds it
  // (docs/spec/room.md#work-reports).
  sent(): Record<string, number>;
  // Raises the sent number of the session to count after core accepted a submit of the lines up to count.
  markSent(session: string, count: number): void;
  append(speaker: string, text: string): void;
  // The lines from the sent number of `session` of the member `self` to the end, without its own lines; null when there is none.
  pending(session: string, self: string): PendingLines | null;
  // Raises the delivered number of the session to its sent number, at least count, at the answer or the acknowledgement of a token;
  // a delivered number never falls.
  markDelivered(session: string, count: number): void;
  // Removes the line at `index` when it is the last line of the record and no session has received it. Returns whether it removed the line.
  withdrawLast(index: number): boolean;
}

const oneLine = (text: string): string => text.replace(/\r\n|\r|\n/g, " ");

// `nameOf` gives the label of a speaker: `owner` for the owner and the roster name of a member. `changed` runs after each change.
export function createRoomRecord(
  lines: RecordLine[],
  delivered: Record<string, number>,
  nameOf: (speaker: string) => string,
  changed: () => void,
  // The sent numbers of the tab state; a record without them starts at the delivered numbers.
  sent: Record<string, number> = delivered,
): RoomRecord {
  const counts = new Map(Object.entries(delivered));
  const sentCounts = new Map(Object.entries(sent));
  for (const [session, count] of counts) {
    if ((sentCounts.get(session) ?? 0) < count) throw new Error(`sent ${session} must be at least its delivered number ${count}`);
  }
  const check = (name: string, session: string, count: number): void => {
    if (!Number.isInteger(count) || count < 0 || count > lines.length) {
      throw new Error(`${name} ${session} must be an integer from 0 to ${lines.length}, got ${JSON.stringify(count)}`);
    }
  };
  return {
    lines,
    delivered: () => Object.fromEntries(counts),
    sent: () => Object.fromEntries(sentCounts),
    markSent(session, count) {
      check("sent", session, count);
      if (count <= (sentCounts.get(session) ?? 0) && sentCounts.has(session)) return;
      sentCounts.set(session, count);
      changed();
    },
    append(speaker, text) {
      lines.push({ speaker, text });
      changed();
    },
    pending(session, self) {
      const from = sentCounts.get(session) ?? 0;
      const own = lines.slice(from).filter((line) => line.speaker !== self);
      if (own.length === 0) return null;
      return {
        text: own.map((line) => `[@${nameOf(line.speaker)}] ${oneLine(line.text)}`).join(" | "),
        speakers: [...new Set(own.map((line) => line.speaker))],
        count: lines.length,
      };
    },
    markDelivered(session, given) {
      check("delivered", session, given);
      const count = Math.max(given, sentCounts.get(session) ?? 0);
      if (count > (sentCounts.get(session) ?? 0) || !sentCounts.has(session)) sentCounts.set(session, count);
      const current = counts.get(session) ?? 0;
      if (count < current) throw new Error(`delivered ${session} cannot fall from ${current} to ${count}`);
      if (count === current && counts.has(session)) return;
      counts.set(session, count);
      changed();
    },
    withdrawLast(index) {
      if (index !== lines.length - 1) return false;
      for (const [session, count] of sentCounts) if (count > index) throw new Error(`record line ${index} was delivered to session ${session}`);
      lines.pop();
      changed();
      return true;
    },
  };
}

// Runs the relay of the last line of the owner; the relay calls `accepted` after each submit that core accepted. A relay that fails before
// core accepted any submit withdraws the line of the owner, because no session received it; any other failed relay keeps it and appends
// the line of the room `the relay failed: <reason>`, so every member reads that the relay failed (docs/spec/room.md#room-record).
export async function settledRelay<T>(record: RoomRecord, relay: (accepted: () => void) => Promise<T>): Promise<T> {
  const index = record.lines.length - 1;
  let accepted = false;
  try {
    return await relay(() => {
      accepted = true;
    });
  } catch (error) {
    if (accepted) record.append("clubhouse", `the relay failed: ${error instanceof Error ? error.message : String(error)}`);
    else record.withdrawLast(index);
    throw error;
  }
}
