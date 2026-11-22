// The state of a room tab (docs/spec/room.md#restart). The room writes it through the tab state of its view (core
// docs/spec/plugins.md#memory-saver, `surface.unload`), which core stores per tab and gives back after a restart, so the room shows
// the same roster checks, mode and conversation without input. The reader accepts only this form and names what it found otherwise.
import type { RoomMode } from "./commands";

export interface RoomState {
  // The roster order and the checked state of each entry.
  roster: { id: string; checked: boolean }[];
  mode: RoomMode;
  // The conversation as the room shows it: the owner or the member identifier, and the text.
  conversation: { speaker: string; text: string }[];
  // The member sessions that this room opened; a tab of one of them whose session has ended is a tab of the room to close.
  sessions: string[];
  // The sessions that received the room protocol.
  taught: string[];
}

const MODES: readonly string[] = ["facil", "turn", "simul"];

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";

export function parseRoomState(value: unknown): RoomState | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`room tab state must be an object, got ${JSON.stringify(value)}`);
  const state = value as Record<string, unknown>;
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
  for (const field of ["sessions", "taught"] as const) {
    const list = state[field];
    if (!Array.isArray(list) || !list.every(isText)) throw new Error(`room tab state: ${field} must be an array of session identifiers`);
  }
  return {
    roster: roster.map((entry) => ({ id: entry.id, checked: entry.checked })),
    mode: state.mode as RoomMode,
    conversation: conversation.map((entry) => ({ speaker: entry.speaker, text: entry.text })),
    sessions: [...(state.sessions as string[])],
    taught: [...(state.taught as string[])],
  };
}
