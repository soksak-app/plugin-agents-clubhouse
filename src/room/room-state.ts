// The state of a room tab (docs/spec/room.md#restart). The room writes it through the tab state of its view (core
// docs/spec/plugins.md#memory-saver, `surface.unload`), which core stores per tab and gives back after a restart, so the room shows
// the same roster checks, mode and conversation without input. The reader accepts only this form and names what it found otherwise.
import type { RoomMode } from "./commands";
import type { OpenToken } from "./answer";

export interface RoomState {
  // The roster order and the checked state of each entry.
  roster: { id: string; checked: boolean }[];
  mode: RoomMode;
  // The conversation as the room shows it: the owner or the member identifier, and the text.
  conversation: { speaker: string; text: string }[];
  // The member sessions that this room opened; a tab of one of them whose session has ended is a tab of the room to close.
  sessions: string[];
  // The sessions that received the room protocol with the answer command (docs/spec/room.md#room-protocol).
  protocolSessions: string[];
  // The number of room record lines that the room delivered to each member session (docs/spec/room.md#room-record).
  delivered: Record<string, number>;
  // The open tokens of turns and record lines, so an answer or an acknowledgement after a restart is accepted
  // (docs/spec/room.md#restart).
  turns: OpenToken[];
}

// The largest tab state that surface.unload of plugin.json declares.
export const ROOM_STATE_MAX_BYTES = 1048576;

// The JSON of the state that the room writes; a state over the declared size is refused with its size.
export function serializedRoomState(state: RoomState): string {
  const json = JSON.stringify(state);
  const bytes = new TextEncoder().encode(json).length;
  if (bytes > ROOM_STATE_MAX_BYTES) throw new Error(`the state is ${bytes} bytes, over the limit of ${ROOM_STATE_MAX_BYTES} bytes`);
  return json;
}

const MODES: readonly string[] = ["facil", "turn", "simul"];
const FIELDS: readonly string[] = ["roster", "mode", "conversation", "sessions", "protocolSessions", "delivered", "turns"];
const KINDS: readonly string[] = ["answer", "record"];

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";

export function parseRoomState(value: unknown): RoomState | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`room tab state must be an object, got ${JSON.stringify(value)}`);
  const state = value as Record<string, unknown>;
  for (const field of Object.keys(state)) if (!FIELDS.includes(field)) throw new Error(`room tab state: unknown field ${field}`);
  const roster = state.roster;
  if (!Array.isArray(roster) || !roster.every((entry) => isText(entry?.id) && typeof entry?.checked === "boolean")) {
    throw new Error("room tab state: roster must be an array of {id, checked}");
  }
  if (!MODES.includes(state.mode as string)) {
    throw new Error(`room tab state: mode must be facil, turn or simul, got ${JSON.stringify(state.mode)}`);
  }
  const conversation = state.conversation;
  if (!Array.isArray(conversation) || !conversation.every((entry) => isText(entry?.speaker) && typeof entry?.text === "string")) {
    throw new Error("room tab state: conversation must be an array of {speaker, text}");
  }
  for (const field of ["sessions", "protocolSessions"] as const) {
    const list = state[field];
    if (!Array.isArray(list) || !list.every(isText)) throw new Error(`room tab state: ${field} must be an array of session identifiers`);
  }
  const delivered = state.delivered;
  if (typeof delivered !== "object" || delivered === null || Array.isArray(delivered)) {
    throw new Error(`room tab state: delivered must be an object of session counts, got ${JSON.stringify(delivered)}`);
  }
  for (const [session, count] of Object.entries(delivered)) {
    if (session === "" || !Number.isInteger(count) || (count as number) < 0 || (count as number) > conversation.length) {
      throw new Error(`room tab state: delivered ${session} must be an integer from 0 to ${conversation.length}, got ${JSON.stringify(count)}`);
    }
  }
  const turns = state.turns;
  if (!Array.isArray(turns)) throw new Error(`room tab state: turns must be an array of open tokens, got ${JSON.stringify(turns)}`);
  for (const token of turns) {
    const valid =
      typeof token === "object" && token !== null &&
      Object.keys(token).every((key) => ["turn", "session", "member", "kind", "count"].includes(key)) &&
      isText(token.turn) && isText(token.session) && isText(token.member) && KINDS.includes(token.kind) &&
      Number.isInteger(token.count) && token.count >= 0 && token.count <= conversation.length;
    if (!valid) {
      throw new Error(
        `room tab state: turns must hold {turn, session, member, kind: answer or record, count from 0 to ${conversation.length}}, got ${JSON.stringify(token)}`,
      );
    }
  }
  return {
    roster: roster.map((entry) => ({ id: entry.id, checked: entry.checked })),
    mode: state.mode as RoomMode,
    conversation: conversation.map((entry) => ({ speaker: entry.speaker, text: entry.text })),
    sessions: [...(state.sessions as string[])],
    protocolSessions: [...(state.protocolSessions as string[])],
    delivered: { ...(delivered as Record<string, number>) },
    turns: turns.map((token) => ({ turn: token.turn, session: token.session, member: token.member, kind: token.kind, count: token.count })),
  };
}
