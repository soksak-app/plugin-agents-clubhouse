// The shared record of a mention exchange (docs/spec/room.md#shared-record). After the mentioned members have answered, each other member
// receives the record as one submitted line. The room waits for no turn of those members and shows none of their output.
// core.session.submit refuses CR and LF, so the record joins its lines with " | " and turns each line break inside a text into a space.
import { sessionProgram, sessionSubmit, type SessionCommandPort } from "./session-channel";

export interface RecordMember {
  id: string;
  name: string;
  session: string;
}

export interface Exchange {
  // The name that the conversation shows for the person.
  sender: string;
  message: string;
  // The answer of each mentioned member, in mention order, as the conversation shows it.
  answers: { member: RecordMember; text: string }[];
}

export interface RecordPorts extends SessionCommandPort {
  // The current value of core.sessions.
  sessions(): unknown;
}

const oneLine = (text: string): string => text.replace(/\r\n|\r|\n/g, " ");

export function recordText(exchange: Exchange): string {
  const names = exchange.answers.map((answer) => `[@${answer.member.name}]`).join(", ");
  return [
    `답은 하지말고 알고있어. [@${exchange.sender}]와 ${names}의 대화기록이다. 답하지말고 참고해.`,
    `@${exchange.sender}: ${oneLine(exchange.message)}`,
    ...exchange.answers.map((answer) => `@${answer.member.name}: ${oneLine(answer.text)}`),
  ].join(" | ");
}

// Submits the record to each member in order. A member that is not idle receives nothing, and that and each refused submit are
// reported; the other members still receive the record.
export async function shareRecord(
  ports: RecordPorts,
  exchange: Exchange,
  others: RecordMember[],
  report: (where: string, text: string) => void,
): Promise<void> {
  const text = recordText(exchange);
  for (const member of others) {
    try {
      const state = sessionProgram(ports.sessions(), member.session);
      if (state !== "idle") {
        report("room record", `member ${member.id} is ${state ?? "without a program state"}: record not sent`);
        continue;
      }
      await sessionSubmit(ports, member.session)(text);
    } catch (error) {
      report("room record", `member ${member.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
