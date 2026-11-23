// The state of a room tab (docs/spec/room.md#restart). The room writes it through the tab state of its view (core
// docs/spec/plugins.md#memory-saver, `surface.unload`), which core stores per tab and gives back after a restart, so the room shows
// the same roster checks, mode and conversation without input. The reader accepts only this form and names what it found otherwise.
import type { RoomMode } from "./commands";
import type { OpenToken } from "./answer";
import type { TeamEntry } from "./team";

export interface RoomState {
  // The roster order, the checked state, the role of each entry and the leader, at most one (docs/spec/room.md#leader).
  roster: { id: string; checked: boolean; role: string; leader: boolean }[];
  // The members that the leader summoned, in summon order (docs/spec/room.md#team).
  team: TeamEntry[];
  mode: RoomMode;
  // The conversation as the room shows it: the owner or the member identifier, and the text.
  conversation: { speaker: string; text: string; at: number | null; elapsedMs: number | null }[];
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

const MODES: readonly string[] = ["facil", "turn", "simul"];
const FIELDS: readonly string[] = ["roster", "team", "mode", "conversation", "sessions", "protocolSessions", "addressed", "delivered", "sent", "turns"];

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";

export function parseRoomState(value: unknown): RoomState | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`room tab state must be an object, got ${JSON.stringify(value)}`);
  const state = value as Record<string, unknown>;
  for (const field of Object.keys(state)) if (!FIELDS.includes(field)) throw new Error(`room tab state: unknown field ${field}`);
  const roster = state.roster;
  if (
    !Array.isArray(roster) ||
    !roster.every((entry) => isText(entry?.id) && typeof entry?.checked === "boolean" && typeof entry?.role === "string" && typeof entry?.leader === "boolean")
  ) {
    throw new Error("room tab state: roster must be an array of {id, checked, role, leader}");
  }
  if (roster.filter((entry) => entry.leader).length > 1) throw new Error("room tab state: roster has more than one leader");
  const team = state.team;
  if (
    !Array.isArray(team) ||
    !team.every((entry) => isText(entry?.id) && isText(entry?.definition) && typeof entry?.role === "string" && typeof entry?.directory === "string" && entry.directory.startsWith("/") && (entry?.merged === null || isText(entry?.merged)) && (entry?.agentSession === null || isText(entry?.agentSession)) && typeof entry?.resume === "boolean" && (entry?.agent === null || isText(entry?.agent)))
  ) {
    throw new Error(`room tab state: team must be an array of {id, definition, role, directory, merged, agentSession, resume, agent}, got ${JSON.stringify(team)}`);
  }
  if (!MODES.includes(state.mode as string)) {
    throw new Error(`room tab state: mode must be facil, turn or simul, got ${JSON.stringify(state.mode)}`);
  }
  const conversation = state.conversation;
  const timeOrNull = (value: unknown): boolean => value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
  if (
    !Array.isArray(conversation) ||
    !conversation.every((entry) => isText(entry?.speaker) && typeof entry?.text === "string" && timeOrNull(entry?.at) && timeOrNull(entry?.elapsedMs))
  ) {
    throw new Error("room tab state: conversation must be an array of {speaker, text, at, elapsedMs}");
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
    roster: roster.map((entry) => ({ id: entry.id, checked: entry.checked, role: entry.role, leader: entry.leader })),
    team: team.map((entry) => ({ id: entry.id, definition: entry.definition, role: entry.role, directory: entry.directory, merged: entry.merged, agentSession: entry.agentSession, resume: entry.resume, agent: entry.agent })),
    mode: state.mode as RoomMode,
    conversation: conversation.map((entry) => ({ speaker: entry.speaker, text: entry.text, at: entry.at, elapsedMs: entry.elapsedMs })),
    sessions: [...(state.sessions as string[])],
    protocolSessions: [...(state.protocolSessions as string[])],
    addressed: Object.fromEntries(Object.entries(addressed as Record<string, number[]>).map(([session, list]) => [session, [...list]])),
    delivered: { ...(delivered as Record<string, number>) },
    sent: { ...(sent as Record<string, number>) },
    turns: turns.map((token) => ({ turn: token.turn, session: token.session, member: token.member, count: token.count })),
  };
}
