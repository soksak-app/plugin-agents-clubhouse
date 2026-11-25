// The state of a room tab (docs/spec/room.md#restart): the assigned group, the conversation, the sessions that the
// room opened, the sessions that received the room protocol and the delivered numbers of the room record, written through the tab state of the view and read back at start.
import { describe, expect, it } from "vitest";
import manifest from "../../plugin.json";
import { parseRoomState, serializedRoomState, type RoomState } from "./room-state";

const state: RoomState = {
  group: "group-1",
  mode: "simul",
  folded: false,
  conversation: [
    { speaker: "owner", text: "한 문장씩만", at: 1700000000000, elapsedMs: null, index: null },
    { speaker: "harness-harness", text: "여러분들, 저는 harness고\n커밋하는 일을 잘해요.", at: 1700000001000, elapsedMs: 900, index: "harness가 커밋을 잘한다고 소개했다." },
  ],
  sessions: ["owned-1"],
  protocolSessions: ["owned-1"],
  addressed: { "owned-1": [0, 1] },
  delivered: { "owned-1": 2 },
  sent: { "owned-1": 2 },
  turns: [{ turn: "t-1", session: "owned-1", member: "harness-harness", count: 2 }],
  worktrees: { "harness-harness": { root: "/work/game", worktree: "/home/p/soksak/worktrees/game-1a2b3c4d/tab-1/harness-harness", branch: "clubhouse/tab-1/harness-harness", integration: "main" } },
  conversations: { "harness-harness": { home: "/home/p/accounts/a", folder: "/home/p/soksak/worktrees/game-1a2b3c4d/tab-1/harness-harness", id: "6f1c2b9e-1d2a-4c3b-9e8f-0a1b2c3d4e5f" } },
};

describe("parseRoomState", () => {
  it("reads the group and the addressed lists (docs/spec/room.md#group)", () => {
    expect(parseRoomState(JSON.parse(serializedRoomState(state)))).toEqual(state);
  });

  it("refuses the roster of the earlier form, a group that is no identifier and an addressed list out of order (docs/spec/room.md#group)", () => {
    const { group: _group, ...rest } = state;
    expect(() => parseRoomState({ ...rest, roster: [] })).toThrow("room tab state: unknown field roster");
    expect(() => parseRoomState(rest)).toThrow("room tab state: group must be a group identifier or null, got undefined");
    expect(() => parseRoomState({ ...state, group: "" })).toThrow('room tab state: group must be a group identifier or null, got ""');
    expect(parseRoomState({ ...state, group: null })?.group).toBeNull();
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
    const big = { ...state, conversation: [{ speaker: "owner", text: "x".repeat(1048576), at: null, elapsedMs: null, index: null }] };
    expect(() => serializedRoomState(big)).toThrow(/^the state is \d+ bytes, over the limit of 1048576 bytes$/);
    expect(JSON.parse(serializedRoomState(state))).toEqual(state);
  });

  it("refuses a state without the delivered numbers of the room record", () => {
    const { delivered: _current, ...rest } = state;
    expect(() => parseRoomState(rest)).toThrow("room tab state: delivered must be an object of session counts, got undefined");
  });

  it("refuses a state without the mode or with a mode other than turn and simul (C154, docs/spec/room.md#modes)", () => {
    const { mode: _mode, ...rest } = state;
    expect(() => parseRoomState(rest)).toThrow("room tab state: mode must be turn or simul, got undefined");
    expect(() => parseRoomState({ ...state, mode: "all" })).toThrow('room tab state: mode must be turn or simul, got "all"');
  });

  it("reads null as a room without a stored state", () => {
    expect(parseRoomState(null)).toBeNull();
  });

  // C148 (docs/spec/room.md#worktrees): the worktree of each member with one.
  it("refuses a worktree that is not {root, worktree, branch, integration} with absolute paths", () => {
    const { worktrees: _w, ...without } = state;
    expect(() => parseRoomState(without)).toThrow("room tab state: worktrees must be an object of member identifier to worktree, got undefined");
    expect(() => parseRoomState({ ...state, worktrees: { a: { root: "work", worktree: "/w", branch: "b", integration: "main" } } })).toThrow(
      'room tab state: worktree a must be {root, worktree, branch, integration} with absolute paths, got {"root":"work","worktree":"/w","branch":"b","integration":"main"}',
    );
  });

  // C131 (docs/spec/room.md#conversation-resume): the conversation of each member whose session opened.
  it("refuses a conversation that is not {home, folder, id} with absolute paths and a UUID or null", () => {
    const { conversations: _c, ...without } = state;
    expect(() => parseRoomState(without)).toThrow("room tab state: conversations must be an object of member identifier to conversation, got undefined");
    expect(parseRoomState({ ...state, conversations: { a: { home: null, folder: "/w", id: null } } })?.conversations).toEqual({ a: { home: null, folder: "/w", id: null } });
    expect(() => parseRoomState({ ...state, conversations: { a: { home: "h", folder: "/w", id: null } } })).toThrow(
      'room tab state: conversation a must be {home, folder, id} with an absolute home or null, an absolute folder and a UUID or null, got {"home":"h","folder":"/w","id":null}',
    );
    expect(() => parseRoomState({ ...state, conversations: { a: { home: null, folder: "/w", id: "x" } } })).toThrow(
      'room tab state: conversation a must be {home, folder, id} with an absolute home or null, an absolute folder and a UUID or null, got {"home":null,"folder":"/w","id":"x"}',
    );
  });

  it("reads back the state that the room wrote, with an answer of several lines", () => {
    expect(parseRoomState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it("refuses a value of another form with the field and the value it found", () => {
    expect(() => parseRoomState({ ...state, folded: "no" })).toThrow('room tab state: folded must be true or false, got "no"');
    const { folded: _f, ...withoutFold } = state;
    expect(() => parseRoomState(withoutFold)).toThrow("room tab state: folded must be true or false, got undefined");
    expect(() => parseRoomState({ ...state, conversation: "x" })).toThrow("room tab state: conversation must be an array of {speaker, text, at, elapsedMs, index}");
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
      "room tab state: conversation must be an array of {speaker, text, at, elapsedMs, index}",
    );
    const timed = [{ speaker: "owner", text: "hi", at: null, elapsedMs: null, index: null }, { speaker: "a", text: "yes", at: 1700000000000, elapsedMs: 12400, index: "a agreed." }];
    expect(parseRoomState({ ...state, conversation: timed })?.conversation).toEqual(timed);
  });

  it("refuses the team of the earlier form, because the room has no team (docs/spec/room.md#leader)", () => {
    expect(() => parseRoomState({ ...state, team: [] })).toThrow("room tab state: unknown field team");
  });

  it("refuses a conversation entry without its index or with an index that is not one non-empty line (docs/spec/room.md#index-sentence)", () => {
    const entry = { speaker: "a", text: "yes", at: 1700000000000, elapsedMs: 12400 };
    for (const conversation of [[entry], [{ ...entry, index: "" }], [{ ...entry, index: "one\ntwo" }], [{ ...entry, index: 3 }]]) {
      expect(() => parseRoomState({ ...state, conversation })).toThrow("room tab state: conversation must be an array of {speaker, text, at, elapsedMs, index}");
    }
  });

  it("is declared as the tab state format 4, the form with the conversation of each member (docs/spec/room.md#restart)", () => {
    expect(manifest.surface.unload).toEqual({ format: 4, maxBytes: 1048576 });
  });
});
