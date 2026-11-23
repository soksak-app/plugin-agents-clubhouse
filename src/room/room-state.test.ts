// The state of a room tab (docs/spec/room.md#restart): the roster order and checks, the mode, the conversation, the sessions that the
// room opened, the sessions that received the room protocol and the delivered numbers of the room record, written through the tab state of the view and read back at start.
import { describe, expect, it } from "vitest";
import { parseRoomState, serializedRoomState, type RoomState } from "./room-state";

const state: RoomState = {
  roster: [{ id: "harness-harness", checked: true, role: "", leader: true }, { id: "moai-manager-lead", checked: false, role: "", leader: false }],
  team: [{ id: "claude-1", definition: "claude", role: "server", directory: "/work/game", merged: null, agentSession: "28e7fee6-d618-4598-b9a6-775f3053340e", resume: true, agent: "manager-develop" }],
  mode: "turn",
  conversation: [
    { speaker: "owner", text: "한 문장씩만", at: null, elapsedMs: null },
    { speaker: "harness-harness", text: "여러분들, 저는 harness고\n커밋하는 일을 잘해요.", at: null, elapsedMs: null },
  ],
  sessions: ["owned-1"],
  protocolSessions: ["owned-1"],
  addressed: { "owned-1": [0, 1] },
  delivered: { "owned-1": 2 },
  sent: { "owned-1": 2 },
  turns: [{ turn: "t-1", session: "owned-1", member: "harness-harness", count: 2 }],
};

describe("parseRoomState", () => {
  it("reads the leader, the team and the addressed lists (docs/spec/room.md#team)", () => {
    expect(parseRoomState(JSON.parse(serializedRoomState(state)))).toEqual(state);
  });

  it("refuses two leaders, a roster entry without leader, a team entry with a relative directory and an addressed list out of order", () => {
    const both = state.roster.map((entry) => ({ ...entry, leader: true }));
    expect(() => parseRoomState({ ...state, roster: both })).toThrow("room tab state: roster has more than one leader");
    expect(() => parseRoomState({ ...state, roster: [{ id: "a", checked: true, role: "" }] })).toThrow("roster must be an array of {id, checked, role, leader}");
    expect(() => parseRoomState({ ...state, team: [{ ...state.team[0], directory: "work" }] })).toThrow("room tab state: team must be an array of {id, definition, role, directory, merged, agentSession, resume, agent}");
    // C97-1: a team entry of the earlier form, without the agent members, is refused.
    const { agentSession: _s, resume: _r, agent: _a, ...earlier } = state.team[0];
    expect(() => parseRoomState({ ...state, team: [earlier] })).toThrow("room tab state: team must be an array of {id, definition, role, directory, merged, agentSession, resume, agent}");
    expect(() => parseRoomState({ ...state, addressed: { "owned-1": [1, 0] } })).toThrow("room tab state: addressed owned-1 must hold increasing record indexes below 2");
  });

  it("refuses a sent position beyond the addressed list of its session", () => {
    expect(() => parseRoomState({ ...state, addressed: { "owned-1": [1] } })).toThrow("room tab state: delivered owned-1 must be an integer from 0 to 1, got 2");
  });

  it("refuses a state of the earlier form without the open tokens", () => {
    const { turns: _current, ...rest } = state;
    expect(() => parseRoomState(rest)).toThrow("room tab state: turns must be an array of open tokens, got undefined");
  });

  it("refuses an open token of the earlier form with a kind, or a count beyond the conversation", () => {
    expect(() => parseRoomState({ ...state, turns: [{ ...state.turns[0], kind: "answer" }] })).toThrow("room tab state: turns must hold");
    expect(() => parseRoomState({ ...state, turns: [{ ...state.turns[0], count: 3 }] })).toThrow("count from 0 to 2");
  });

  it("refuses to write a state over the 1048576 bytes of surface.unload, with its size", () => {
    const big = { ...state, conversation: [{ speaker: "owner", text: "x".repeat(1048576), at: null, elapsedMs: null }] };
    expect(() => serializedRoomState(big)).toThrow(/^the state is \d+ bytes, over the limit of 1048576 bytes$/);
    expect(JSON.parse(serializedRoomState(state))).toEqual(state);
  });

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
    expect(() => parseRoomState({ ...state, roster: [{ id: 1 }] })).toThrow("room tab state: roster must be an array of {id, checked, role, leader}");
    expect(() => parseRoomState({ ...state, conversation: "x" })).toThrow("room tab state: conversation must be an array of {speaker, text, at, elapsedMs}");
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

  it("refuses a conversation entry without its times, and accepts null times (docs/spec/room.md#timing)", () => {
    expect(() => parseRoomState({ ...state, conversation: [{ speaker: "owner", text: "hi" }] })).toThrow(
      "room tab state: conversation must be an array of {speaker, text, at, elapsedMs}",
    );
    const timed = [{ speaker: "owner", text: "hi", at: null, elapsedMs: null }, { speaker: "a", text: "yes", at: 1700000000000, elapsedMs: 12400 }];
    expect(parseRoomState({ ...state, conversation: timed })?.conversation).toEqual(timed);
  });
});
