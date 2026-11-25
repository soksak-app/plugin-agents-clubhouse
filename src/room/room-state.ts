// The state of a room tab (docs/spec/room.md#restart). The room writes it through the tab state of its view (core
// docs/spec/plugins.md#memory-saver, `surface.unload`), which core stores per tab and gives back after a restart, so the room shows
// the same group and conversation without input. The reader accepts only this form and names what it found otherwise.
import { isIndexSentence, type OpenToken } from "./answer";

export interface RoomState {
  // The identifier of the assigned group of the agents plugin, or null without one (docs/spec/room.md#group).
  group: string | null;
  // Whether the member grid of the header is folded to its first two rows (docs/spec/room.md#header).
  folded: boolean;
  // The conversation as the room shows it: the owner or the member identifier, and the text.
  conversation: { speaker: string; text: string; at: number | null; elapsedMs: number | null; index: string | null }[];
  // The member sessions that this room opened; a tab of one of them whose session has ended is a tab of the room to close.
  sessions: string[];
  // The sessions that received the room protocol with the answer command (docs/spec/room.md#room-protocol).
  protocolSessions: string[];
  // The addressed list of each member session: the record indexes of the lines addressed to it (docs/spec/room.md#addressed-views).
  addressed: Record<string, number[]>;
  // The delivered position of each member session in its addressed list (docs/spec/room.md#room-record).
  delivered: Record<string, number>;
  // The sent position of each member session in its addressed list, at least its delivered position (docs/spec/room.md#work-reports).
  sent: Record<string, number>;
  // The open turn tokens, so an answer after a restart is accepted
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

const FIELDS: readonly string[] = ["group", "folded", "conversation", "sessions", "protocolSessions", "addressed", "delivered", "sent", "turns"];

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";

export function parseRoomState(value: unknown): RoomState | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`room tab state must be an object, got ${JSON.stringify(value)}`);
  const state = value as Record<string, unknown>;
  for (const field of Object.keys(state)) if (!FIELDS.includes(field)) throw new Error(`room tab state: unknown field ${field}`);
  const group = state.group;
  if (!(group === null || isText(group))) throw new Error(`room tab state: group must be a group identifier or null, got ${JSON.stringify(group)}`);
  if (typeof state.folded !== "boolean") throw new Error(`room tab state: folded must be true or false, got ${JSON.stringify(state.folded)}`);
  const conversation = state.conversation;
  const timeOrNull = (value: unknown): boolean => value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
  if (
    !Array.isArray(conversation) ||
    !conversation.every((entry) => isText(entry?.speaker) && typeof entry?.text === "string" && timeOrNull(entry?.at) && timeOrNull(entry?.elapsedMs) && (entry?.index === null || isIndexSentence(entry?.index)))
  ) {
    throw new Error("room tab state: conversation must be an array of {speaker, text, at, elapsedMs, index}");
  }
  for (const field of ["sessions", "protocolSessions"] as const) {
    const list = state[field];
    if (!Array.isArray(list) || !list.every(isText)) throw new Error(`room tab state: ${field} must be an array of session identifiers`);
  }
  const addressed = state.addressed;
  if (typeof addressed !== "object" || addressed === null || Array.isArray(addressed)) {
    throw new Error(`room tab state: addressed must be an object of record index lists, got ${JSON.stringify(addressed)}`);
  }
  for (const [session, list] of Object.entries(addressed)) {
    const increasing = Array.isArray(list) && list.every((index, at) => Number.isInteger(index) && index >= 0 && index < conversation.length && (at === 0 || index > list[at - 1]));
    if (session === "" || !increasing) {
      throw new Error(`room tab state: addressed ${session} must hold increasing record indexes below ${conversation.length}, got ${JSON.stringify(list)}`);
    }
  }
  const lengthOf = (session: string): number => (addressed as Record<string, number[]>)[session]?.length ?? conversation.length;
  const delivered = state.delivered;
  if (typeof delivered !== "object" || delivered === null || Array.isArray(delivered)) {
    throw new Error(`room tab state: delivered must be an object of session counts, got ${JSON.stringify(delivered)}`);
  }
  for (const [session, count] of Object.entries(delivered)) {
    if (session === "" || !Number.isInteger(count) || (count as number) < 0 || (count as number) > lengthOf(session)) {
      throw new Error(`room tab state: delivered ${session} must be an integer from 0 to ${lengthOf(session)}, got ${JSON.stringify(count)}`);
    }
  }
  const sent = state.sent;
  if (typeof sent !== "object" || sent === null || Array.isArray(sent)) {
    throw new Error(`room tab state: sent must be an object of session counts, got ${JSON.stringify(sent)}`);
  }
  for (const [session, count] of Object.entries(sent)) {
    const least = (delivered as Record<string, number>)[session] ?? 0;
    if (session === "" || !Number.isInteger(count) || (count as number) < least || (count as number) > lengthOf(session)) {
      throw new Error(`room tab state: sent ${session} must be an integer from ${least} to ${lengthOf(session)}, got ${JSON.stringify(count)}`);
    }
  }
  for (const session of Object.keys(delivered as object)) {
    if (!(session in sent)) throw new Error(`room tab state: sent has no count for the delivered session ${session}`);
  }
  const turns = state.turns;
  if (!Array.isArray(turns)) throw new Error(`room tab state: turns must be an array of open tokens, got ${JSON.stringify(turns)}`);
  for (const token of turns) {
    const valid =
      typeof token === "object" && token !== null &&
      Object.keys(token).every((key) => ["turn", "session", "member", "count"].includes(key)) &&
      isText(token.turn) && isText(token.session) && isText(token.member) &&
      Number.isInteger(token.count) && token.count >= 0 && token.count <= conversation.length;
    if (!valid) {
      throw new Error(
        `room tab state: turns must hold {turn, session, member, count from 0 to ${conversation.length}}, got ${JSON.stringify(token)}`,
      );
    }
  }
  return {
    group,
    folded: state.folded,
    conversation: conversation.map((entry) => ({ speaker: entry.speaker, text: entry.text, at: entry.at, elapsedMs: entry.elapsedMs, index: entry.index })),
    sessions: [...(state.sessions as string[])],
    protocolSessions: [...(state.protocolSessions as string[])],
    addressed: Object.fromEntries(Object.entries(addressed as Record<string, number[]>).map(([session, list]) => [session, [...list]])),
    delivered: { ...(delivered as Record<string, number>) },
    sent: { ...(sent as Record<string, number>) },
    turns: turns.map((token) => ({ turn: token.turn, session: token.session, member: token.member, count: token.count })),
  };
}
