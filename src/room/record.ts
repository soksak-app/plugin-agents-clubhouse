// The shared record of a mention exchange (docs/spec/room.md#shared-record). After the mentioned members have answered, each other member
// receives the record lines that it has not received as one submitted line. The room waits for no turn of those members and shows none of their output.
// Each record line names its speaker (docs/spec/room.md#speaker-labels). core.session.submit refuses CR and LF, so the record joins its lines with " | " and turns each line break inside a text into a space.
import { sessionProgram, sessionSubmit, type SessionCommandPort } from "./session-channel";
import type { PendingLines, RoomRecord } from "./room-record";

export interface RecordMember {
  id: string;
  name: string;
  session: string;
}

export interface RecordPorts extends SessionCommandPort {
  // The current value of core.sessions.
  sessions(): unknown;
}

// The text that a member outside the exchange receives: the preface, then the record lines that it has not received.
export function recordText(pending: PendingLines, nameOf: (speaker: string) => string): string {
  const names = pending.speakers.filter((speaker) => speaker !== "owner").map((speaker) => `[@${nameOf(speaker)}]`).join(", ");
  return `답은 하지말고 알고있어. [@owner]와 ${names}의 대화기록이다. 답하지말고 참고해. | ${pending.text}`;
}

// Submits to each member in order the record lines that it has not received, and sets its delivered number after an accepted submit. A
// member that is not idle receives nothing, and that and each refused submit are reported; the other members still receive the record.
export async function shareRecord(
  ports: RecordPorts,
  record: RoomRecord,
  others: RecordMember[],
  nameOf: (speaker: string) => string,
  report: (where: string, text: string) => void,
): Promise<void> {
  for (const member of others) {
    try {
      const pending = record.pending(member.session, member.id);
      if (pending === null) continue;
      const state = sessionProgram(ports.sessions(), member.session);
      if (state !== "idle") {
        report("room record", `member ${member.id} is ${state ?? "without a program state"}: record not sent`);
        continue;
      }
      await sessionSubmit(ports, member.session)(recordText(pending, nameOf));
      record.markDelivered(member.session, pending.count);
    } catch (error) {
      report("room record", `member ${member.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
