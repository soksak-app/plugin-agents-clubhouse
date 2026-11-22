// The conversation status of the room (docs/spec/room.md#conversation-status): the entries {speaker, text} of the room record that
// the page shows, each member whose turn the room waits for, with its step and the program state of its session in core.sessions, and
// the delivered number of each session of the closing delivery beside the length of the record.
// The room calls changed after each change of the record and at each value of core.sessions; a wait publishes when it begins and
// when it ends. Each subscriber receives the new value, so the status follows these events without a timer.
import { sessionProgram } from "./session-channel";
import type { AnswerSection } from "./sections";

export interface ConversationEntry {
  // `owner` or the identifier of a member.
  speaker: string;
  text: string;
}

// An entry of the status: the record entry and the sections of its answer (docs/spec/room.md#sections), [] for an entry without them.
export interface StatusEntry extends ConversationEntry {
  sections: AnswerSection[];
}

// `protocol` from the start of the protocol turn, which waits for the first idle, to its end; `answer` from the submit of a relayed
// line to its answer or its failure; `record` from the submit of a record line to its acknowledgement or the stop of its wait.
export type WaitingStep = "protocol" | "answer" | "record";

export interface WaitingMember {
  member: string;
  session: string;
  step: WaitingStep;
  // The program state of core.sessions, null while core reports none, ended when core.sessions no longer lists the session.
  program: "idle" | "working" | "blocked" | "ended" | null;
}

// A session of the closing delivery (docs/spec/room.md#closing-delivery); delivered below length outside a relay and a wait is a line
// that the session has not received.
export interface DeliveryEntry {
  member: string;
  session: string;
  // The record lines that the room submitted to the session (docs/spec/room.md#work-reports).
  sent: number;
  delivered: number;
  length: number;
  // Whether the room waits for the next idle of the session to deliver its lines.
  pending: boolean;
}

export interface ConversationValue {
  entries: StatusEntry[];
  waiting: WaitingMember[];
  delivery: DeliveryEntry[];
}

// Begins a wait for the member and returns the function that ends it; ending it again changes nothing.
export type BeginWaiting = (member: { id: string; session: string }, step: WaitingStep) => () => void;

export interface ConversationStatus {
  read(): ConversationValue;
  subscribe(listener: (value: ConversationValue) => void): () => void;
  changed(): void;
  waiting: BeginWaiting;
}

function programOf(sessions: { session?: unknown }[], session: string): WaitingMember["program"] {
  if (!sessions.some((entry) => entry?.session === session)) return "ended";
  return sessionProgram(sessions, session);
}

// `sessions` gives the current value of core.sessions, and `delivery` the entries of the closing delivery.
export function createConversationStatus(
  lines: readonly ConversationEntry[],
  sessions: () => unknown,
  delivery: () => DeliveryEntry[],
  sections: (entry: ConversationEntry) => AnswerSection[] = () => [],
): ConversationStatus {
  const listeners = new Set<(value: ConversationValue) => void>();
  const waits = new Set<{ member: string; session: string; step: WaitingStep }>();
  const read = (): ConversationValue => {
    const value = sessions();
    if (!Array.isArray(value)) throw new Error("core.sessions is not a list");
    return {
      entries: lines.map((line) => ({ speaker: line.speaker, text: line.text, sections: sections(line) })),
      waiting: [...waits].map((wait) => ({ ...wait, program: programOf(value as { session?: unknown }[], wait.session) })),
      delivery: delivery().map((entry) => ({ ...entry })),
    };
  };
  const changed = (): void => {
    const value = read();
    for (const listener of [...listeners]) listener(value);
  };
  return {
    read,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    changed,
    waiting(member, step) {
      const wait = { member: member.id, session: member.session, step };
      waits.add(wait);
      changed();
      return () => {
        if (waits.delete(wait)) changed();
      };
    },
  };
}
