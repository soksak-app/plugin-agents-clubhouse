// The state of a room tab (docs/spec/room.md#restart): the roster order and checks, the mode, the conversation, the sessions that the
// room opened and the sessions that received the room protocol, written through the tab state of the view and read back at start.
import { describe, expect, it } from "vitest";
import { parseRoomState, type RoomState } from "./room-state";
import fixture from "./fixtures/member-screens.json";
import { turnAnswer } from "./answer";

const state: RoomState = {
  roster: [{ id: "harness-harness", checked: true }, { id: "moai-manager-lead", checked: false }],
  mode: "turn",
  conversation: [
    { speaker: "owner", text: "한 문장씩만" },
    { speaker: "harness-harness", text: turnAnswer(fixture.screens[0].rows) },
  ],
  sessions: ["owned-1"],
  taught: ["owned-1"],
};

describe("parseRoomState", () => {
  it("reads null as a room without a stored state", () => {
    expect(parseRoomState(null)).toBeNull();
  });

  it("reads back the state that the room wrote, with the clean answer of a member", () => {
    expect(parseRoomState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(state.conversation[1].text).not.toContain("✻");
  });

  it("refuses a value of another form with the field and the value it found", () => {
    expect(() => parseRoomState({ ...state, mode: "solo" })).toThrow('room tab state: mode must be facil, turn or simul, got "solo"');
    expect(() => parseRoomState({ ...state, roster: [{ id: 1 }] })).toThrow("room tab state: roster must be an array of {id, checked}");
    expect(() => parseRoomState({ ...state, conversation: "x" })).toThrow("room tab state: conversation must be an array of {speaker, text}");
    expect(() => parseRoomState({ ...state, taught: [3] })).toThrow("room tab state: taught must be an array of session identifiers");
    expect(() => parseRoomState([])).toThrow("room tab state must be an object, got []");
  });
});
