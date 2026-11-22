// The conversation status of the room (docs/spec/room.md#conversation-status): the entries {speaker, text} of the room record that
// the page shows, each member whose turn the room waits for, with its step and the program state of its session in core.sessions, and
// the sent and delivered numbers of the session of each member beside the length of the record and its unreceived lines.
// The room calls changed after each change of the record and at each value of core.sessions; a wait publishes when it begins and
// when it ends. Each subscriber receives the new value, so the status follows these events without a timer.
import { sessionProgram } from "./session-channel";
import type { AnswerSection } from "./sections";
import type { TeamViewEntry } from "./team";

export interface ConversationEntry {
  // `owner` or the identifier of a member.
  speaker: string;
  text: string;
  // The time at which the room took the entry in epoch milliseconds, null for an entry without a time (docs/spec/room.md#timing).
  at: number | null;
  // The time of the turn of an answer in milliseconds, null otherwise.
  elapsedMs: number | null;
}

// An entry of the status: the record entry and the sections of its answer (docs/spec/room.md#sections), [] for an entry without them.
export interface StatusEntry extends ConversationEntry {
  sections: AnswerSection[];
}

// `turn` while a turn line waits for a blocked session (docs/spec/room.md#turn-end); `protocol` from the start of the protocol turn,
// which waits for the first idle, to its end; `answer` from the submit of a turn line to its answer, its failure or the stop.
export type WaitingStep = "protocol" | "turn" | "answer";

export interface WaitingMember {
  member: string;
  session: string;
  step: WaitingStep;
  // The program state of core.sessions, null while core reports none, ended when core.sessions no longer lists the session.
  program: "idle" | "working" | "blocked" | "ended" | null;
}

// The session of a member of the room and the record lines that it has not received, which its next turn line carries
// (docs/spec/room.md#conversation-status).
export interface DeliveryEntry {
  member: string;
  session: string;
  // The record lines that the room submitted to the session (docs/spec/room.md#work-reports).
  sent: number;
  delivered: number;
  length: number;
  // The record lines from sent to the end that its member did not speak.
  unreceived: number;
}

export interface ConversationValue {
  entries: StatusEntry[];
  waiting: WaitingMember[];
  delivery: DeliveryEntry[];
  // The team view of a room with a leader (docs/spec/room.md#team), [] without a team.
  team: TeamViewEntry[];
}

// The label of a wait in the view: an answer wait whose session is idle shows `idle without answer`, a display only
// (docs/spec/room.md#conversation-status).
export function waitLabel(wait: WaitingMember): string {
  return wait.step === "answer" && wait.program === "idle" ? "idle without answer" : wait.step;
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

// `sessions` gives the current value of core.sessions, and `delivery` the delivery entries of the members.
export function createConversationStatus(
  lines: readonly ConversationEntry[],
  sessions: () => unknown,
  delivery: () => DeliveryEntry[],
  sections: (entry: ConversationEntry) => AnswerSection[] = () => [],
  team: () => TeamViewEntry[] = () => [],
): ConversationStatus {
  const listeners = new Set<(value: ConversationValue) => void>();
  const waits = new Set<{ member: string; session: string; step: WaitingStep }>();
  const read = (): ConversationValue => {
    const value = sessions();
    if (!Array.isArray(value)) throw new Error("core.sessions is not a list");
    return {
      entries: lines.map((line) => ({ speaker: line.speaker, text: line.text, at: line.at, elapsedMs: line.elapsedMs, sections: sections(line) })),
      waiting: [...waits].map((wait) => ({ ...wait, program: programOf(value as { session?: unknown }[], wait.session) })),
      delivery: delivery().map((entry) => ({ ...entry })),
      team: team().map((entry) => ({ ...entry })),
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
