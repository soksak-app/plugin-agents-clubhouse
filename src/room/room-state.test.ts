// The state of a room tab (docs/spec/room.md#restart): the roster order and checks, the mode, the conversation, the sessions that the
// room opened, the sessions that received the room protocol and the delivered numbers of the room record, written through the tab state of the view and read back at start.
import { describe, expect, it } from "vitest";
import { parseRoomState, type RoomState } from "./room-state";

const state: RoomState = {
  roster: [{ id: "harness-harness", checked: true }, { id: "moai-manager-lead", checked: false }],
  mode: "turn",
  conversation: [
    { speaker: "owner", text: "한 문장씩만" },
    { speaker: "harness-harness", text: "여러분들, 저는 harness고\n커밋하는 일을 잘해요." },
  ],
  sessions: ["owned-1"],
  protocolSessions: ["owned-1"],
  delivered: { "owned-1": 2 },
};

describe("parseRoomState", () => {
  it("refuses a state without the delivered numbers of the room record", () => {
    const { delivered: _current, ...rest } = state;
    expect(() => parseRoomState(rest)).toThrow("room tab state: delivered must be an object of session counts, got undefined");
  });

  it("reads null as a room without a stored state", () => {
    expect(parseRoomState(null)).toBeNull();
  });

  it("reads back the state that the room wrote, with an answer of several lines", () => {
    expect(parseRoomState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it("refuses a value of another form with the field and the value it found", () => {
    expect(() => parseRoomState({ ...state, mode: "solo" })).toThrow('room tab state: mode must be facil, turn or simul, got "solo"');
    expect(() => parseRoomState({ ...state, roster: [{ id: 1 }] })).toThrow("room tab state: roster must be an array of {id, checked}");
    expect(() => parseRoomState({ ...state, conversation: "x" })).toThrow("room tab state: conversation must be an array of {speaker, text}");
    expect(() => parseRoomState({ ...state, protocolSessions: [3] })).toThrow(
      "room tab state: protocolSessions must be an array of session identifiers",
    );
    expect(() => parseRoomState({ ...state, delivered: { "owned-1": 3 } })).toThrow(
      "room tab state: delivered owned-1 must be an integer from 0 to 2, got 3",
    );
    expect(() => parseRoomState({ ...state, delivered: [] })).toThrow("room tab state: delivered must be an object of session counts, got []");
    expect(() => parseRoomState([])).toThrow("room tab state must be an object, got []");
  });

  it("refuses the earlier field taught, whose sessions received a protocol line without the answer command", () => {
    const { protocolSessions: _current, ...rest } = state;
    expect(() => parseRoomState({ ...rest, taught: ["owned-1"] })).toThrow("room tab state: unknown field taught");
  });
});
