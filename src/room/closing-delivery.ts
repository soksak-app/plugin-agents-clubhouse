// The closing delivery of the room (docs/spec/room.md#closing-delivery). After each relay the room sends each member session of the
// delivery the record lines that it has not received as one record line that ends with the token of a record turn, and the member
// acknowledges it with soksak-plugin-agents-clubhouse.record.ack. The acknowledgement raises the delivered number of the session through
// the token channel. A session that is not idle receives nothing and is pending: while no relay runs, the next value of core.sessions in
// which it is idle, each settled token and the end of the start of the room run the delivery again. Each of these is an event, so the
// delivery needs no timer.
import { sessionProgram, sessionSubmit, type SessionCommandPort } from "./session-channel";
import type { AnswerChannel } from "./answer";
import type { PendingLines, RoomRecord } from "./room-record";
import type { BeginWaiting, DeliveryEntry } from "./conversation-status";

export interface DeliveryMember {
  id: string;
  name: string;
  session: string;
}

export interface DeliveryPorts extends SessionCommandPort {
  answers: AnswerChannel;
  // The current value of core.sessions.
  sessions(): unknown;
  waiting: BeginWaiting;
  report(where: string, text: string): void;
  // Runs after each change of the pending sessions and of the record waits.
  changed(): void;
}

export interface ClosingDelivery {
  // Runs the closing delivery for the sessions that have lines to receive; it reports each failure itself and never rejects.
  run(): Promise<void>;
  // Runs `relay` as the current relay: no delivery runs on an event during it, and the closing delivery runs after it.
  relay<T>(relay: () => Promise<T>): Promise<T>;
  // Runs the delivery on a value of core.sessions when no relay runs and a pending session is idle in it.
  sessionsChanged(value: unknown): void;
  // Ends the waits of the tokens that closed, and runs the delivery when no relay runs; the token channel calls it at each change.
  tokensChanged(): void;
  // Ends each record wait and each wait of a token kept from before a restart; returns the number of waits that it ended.
  stopWaits(): number;
  // Whether a record wait or a wait of a kept token is open.
  waits(): boolean;
  // The delivery entries of the conversation status.
  entries(): DeliveryEntry[];
}

// The text of a record line: the preface, then the record lines that the session has not received.
export function recordText(pending: PendingLines, nameOf: (speaker: string) => string): string {
  const names = pending.speakers.filter((speaker) => speaker !== "owner").map((speaker) => `[@${nameOf(speaker)}]`).join(", ");
  return `답은 하지말고 알고있어. [@owner]와 ${names}의 대화기록이다. 답하지말고 참고해. | ${pending.text}`;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// `members` gives the sessions of the delivery: the checked members whose session core.sessions lists and that received the protocol.
export function createClosingDelivery(
  ports: DeliveryPorts,
  record: RoomRecord,
  nameOf: (speaker: string) => string,
  members: () => DeliveryMember[],
): ClosingDelivery {
  // The sessions that wait for their next idle to receive their lines, and the sessions whose record wait the owner stopped, which
  // receive no closing delivery until the next relay.
  const pending = new Set<string>();
  const held = new Set<string>();
  // The pending sessions that the next run delivers to: all of them after a relay, and those that a value of core.sessions shows idle.
  let retrying = new Set<string>();
  // The end of the conversation-status wait of each open record token and of each kept token, by token.
  const waits = new Map<string, () => void>();
  for (const token of ports.answers.tokens()) {
    waits.set(token.turn, ports.waiting({ id: token.member, session: token.session }, token.kind === "record" ? "record" : "answer"));
  }
  let relaying = false;
  // While stopWaits closes tokens, their closes start no delivery.
  let stopping = false;
  let running: Promise<void> | null = null;
  let again = false;

  const deliverOne = async (member: DeliveryMember): Promise<void> => {
    const session = member.session;
    if (held.has(session) || ports.answers.has(session)) return;
    if (pending.has(session) && !retrying.delete(session)) return;
    if ((record.delivered()[session] ?? 0) >= record.lines.length) {
      if (pending.delete(session)) ports.changed();
      return;
    }
    const lines = record.pending(session, member.id);
    if (lines === null) {
      // Every line that the session has not received is a line of its own member, so it has nothing to receive.
      record.markDelivered(session, record.lines.length);
      if (pending.delete(session)) ports.changed();
      return;
    }
    const state = sessionProgram(ports.sessions(), session);
    if (state !== "idle") {
      if (!pending.has(session)) {
        pending.add(session);
        ports.changed();
        ports.report("room record", `member ${member.id} is ${state ?? "without a program state"}`);
      }
      return;
    }
    const token = ports.answers.open(session, member.id, "record", lines.count);
    const endWait = ports.waiting(member, "record");
    waits.set(token.turn, endWait);
    try {
      await sessionSubmit(ports, session)(`${recordText(lines, nameOf)} | [@clubhouse] record ${token.turn}`);
      if (pending.delete(session)) ports.changed();
    } catch (error) {
      token.close();
      waits.delete(token.turn);
      endWait();
      const known = pending.has(session);
      pending.add(session);
      ports.changed();
      if (!known) ports.report("room record", `member ${member.id}: ${messageOf(error)}`);
    }
  };

  const once = async (): Promise<void> => {
    for (const member of members()) {
      try {
        await deliverOne(member);
      } catch (error) {
        ports.report("room record", `member ${member.id}: ${messageOf(error)}`);
      }
    }
  };

  const run = (): Promise<void> => {
    if (running !== null) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await once();
      } while (again);
    })().finally(() => {
      running = null;
    });
    return running;
  };

  return {
    run,
    async relay(task) {
      relaying = true;
      held.clear();
      try {
        return await task();
      } finally {
        relaying = false;
        retrying = new Set(pending);
        await run();
      }
    },
    sessionsChanged(value) {
      if (relaying || pending.size === 0) return;
      for (const session of pending) {
        try {
          if (sessionProgram(value, session) === "idle") retrying.add(session);
        } catch {
          // A session that core.sessions no longer lists has left the delivery.
          pending.delete(session);
        }
      }
      if (retrying.size > 0) void run();
    },
    tokensChanged() {
      const open = new Set(ports.answers.tokens().map((token) => token.turn));
      for (const [turn, endWait] of [...waits]) {
        if (open.has(turn)) continue;
        waits.delete(turn);
        endWait();
      }
      if (!relaying && !stopping) void run();
    },
    stopWaits() {
      stopping = true;
      let closed;
      try {
        closed = ports.answers.closeWaits();
      } finally {
        stopping = false;
      }
      for (const token of closed) {
        held.add(token.session);
        const endWait = waits.get(token.turn);
        waits.delete(token.turn);
        endWait?.();
        ports.report("room record", `member ${token.member}: record wait stopped`);
      }
      if (closed.length > 0) ports.changed();
      return closed.length;
    },
    waits: () => ports.answers.tokens().some((token) => waits.has(token.turn)),
    entries() {
      const delivered = record.delivered();
      return members().map((member) => ({
        member: member.id,
        session: member.session,
        delivered: delivered[member.session] ?? 0,
        length: record.lines.length,
        pending: pending.has(member.session),
      }));
    },
  };
}
