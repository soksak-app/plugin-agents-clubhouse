// The answer channel of the room (docs/spec/room.md#answer): each relayed line carries the token of its turn, a member delivers its
// answer with the declared command soksak-plugin-agents-clubhouse.answer {turn, text}, and the room accepts each token once, only
// while its turn is open.
import { describe, expect, it } from "vitest";
import { ANSWER_COMMAND, ANSWER_NEXT, createAnswerChannel, type OpenToken } from "./answer";

const counter = () => {
  let next = 0;
  return () => `t-${++next}`;
};

describe("createAnswerChannel", () => {
  it("resolves the open turn of the token with the delivered text, whole and unchanged", async () => {
    const channel = createAnswerChannel({ newTurn: counter(), delivered: () => {}, restoredAnswer: () => {}, changed: () => {} });
    const turn = channel.open("s-1", "m", 0);
    expect(turn.turn).toBe("t-1");
    const text = Array.from({ length: 451 }, (_, index) => `row ${index}`).join("\n");
    expect(channel.deliver({ status: "settled", turn: "t-1", text })).toEqual({ turn: "t-1", next: ANSWER_NEXT });
    await expect(turn.answer).resolves.toEqual({ text, status: "settled" });
  });

  it("refuses a token of no open turn, also a second answer of one turn and an answer after the close of its turn", () => {
    const channel = createAnswerChannel({ newTurn: counter(), delivered: () => {}, restoredAnswer: () => {}, changed: () => {} });
    expect(() => channel.deliver({ status: "settled", turn: "t-9", text: "hi" })).toThrow("turn t-9 is not an open turn of this room");
    channel.open("s-1", "m", 0);
    channel.deliver({ status: "settled", turn: "t-1", text: "first" });
    expect(() => channel.deliver({ status: "settled", turn: "t-1", text: "second" })).toThrow("turn t-1 is not an open turn of this room");
    channel.open("s-1", "m", 0).close();
    expect(() => channel.deliver({ status: "settled", turn: "t-2", text: "late" })).toThrow("turn t-2 is not an open turn of this room");
  });

  it("gives each turn its own token, so the answer of one member never ends the turn of another", async () => {
    const channel = createAnswerChannel({ newTurn: counter(), delivered: () => {}, restoredAnswer: () => {}, changed: () => {} });
    const first = channel.open("s-1", "m", 0);
    const second = channel.open("s-2", "m", 0);
    channel.deliver({ status: "settled", turn: second.turn, text: "of s-2" });
    channel.deliver({ status: "settled", turn: first.turn, text: "of s-1" });
    await expect(first.answer).resolves.toEqual({ text: "of s-1", status: "settled" });
    await expect(second.answer).resolves.toEqual({ text: "of s-2", status: "settled" });
  });

  it("refuses invalid parameters with the parameter and the value", () => {
    const channel = createAnswerChannel({ newTurn: counter(), delivered: () => {}, restoredAnswer: () => {}, changed: () => {} });
    channel.open("s-1", "m", 0);
    expect(() => channel.deliver({ status: "settled", turn: "", text: "x" })).toThrow('turn must be a non-empty string, got ""');
    expect(() => channel.deliver({ status: "settled", turn: "t-1", text: "  " })).toThrow('text must be a non-empty string, got "  "');
    expect(() => channel.deliver({ status: "settled", turn: "t-1", text: 3 })).toThrow("text must be a non-empty string, got 3");
  });

  it("refuses a second open turn of one session", () => {
    const channel = createAnswerChannel({ newTurn: counter(), delivered: () => {}, restoredAnswer: () => {}, changed: () => {} });
    channel.open("s-1", "m", 0);
    expect(() => channel.open("s-1", "m", 0)).toThrow("session s-1 has an open turn");
  });

  it("names the declared command", () => {
    expect(ANSWER_COMMAND).toBe("soksak-plugin-agents-clubhouse.answer");
  });

  it("raises the delivered number of the session to the count of the token only when its answer arrives", () => {
    const raised: string[] = [];
    const channel = createAnswerChannel({ newTurn: counter(), delivered: (session, count) => void raised.push(`${session}=${count}`), restoredAnswer: () => {}, changed: () => {} });
    const turn = channel.open("s-1", "a", 3);
    expect(raised).toEqual([]);
    channel.deliver({ status: "settled", turn: turn.turn, text: "hi" });
    expect(raised).toEqual(["s-1=3"]);
  });

  it("accepts the tokens of the tab state after a restart: an answer is the answer of its member and raises the delivered number", () => {
    const raised: string[] = [];
    const answered: string[] = [];
    const restored: OpenToken[] = [{ turn: "old-1", session: "s-1", member: "a", count: 2 }];
    const channel = createAnswerChannel({
      newTurn: counter(),
      restored,
      delivered: (session, count) => void raised.push(`${session}=${count}`),
      restoredAnswer: (token, text) => void answered.push(`${token.member}:${text}`),
      changed: () => {},
    });
    expect(channel.tokens()).toEqual(restored);
    channel.deliver({ status: "settled", turn: "old-1", text: "late answer" });
    expect(raised).toEqual(["s-1=2"]);
    expect(answered).toEqual(["a:late answer"]);
    expect(channel.tokens()).toEqual([]);
  });

  it("closes the restored tokens and keeps the tokens of a running relay", () => {
    const channel = createAnswerChannel({
      newTurn: counter(),
      restored: [{ turn: "old-1", session: "s-3", member: "c", count: 0 }],
      delivered: () => {},
      restoredAnswer: () => {},
      changed: () => {},
    });
    channel.open("s-1", "a", 0);
    expect(channel.closeWaits().map((token) => token.turn)).toEqual(["old-1"]);
    expect(channel.tokens().map((token) => token.turn)).toEqual(["t-1"]);
  });
});

// A reload of the room page (C91): the page ends while a member holds its turn token, and the next page reads the open tokens from the
// tab state that the first page wrote at each change, so the answer after the reload is accepted and raises the delivered position.
describe("an answer across a reload of the room page", () => {
  it("accepts the answer of a token that the page before the reload opened, from the written tab state", async () => {
    const { parseRoomState, serializedRoomState } = await import("./room-state");
    const { createRoomRecord } = await import("./room-record");
    const conversation = [{ speaker: "owner", text: "go", at: null, elapsedMs: null }];
    let written = "";
    const before = createAnswerChannel({ newTurn: counter(), delivered: () => {}, restoredAnswer: () => {}, changed: () => {
      written = serializedRoomState({
        roster: [], mode: "turn", folded: false, conversation, sessions: ["s-1"], protocolSessions: ["s-1"],
        addressed: { "s-1": [0] }, delivered: { "s-1": 0 }, sent: { "s-1": 1 }, turns: before.tokens(),
      });
    } });
    before.open("s-1", "m", 1);
    // The page reloads: nothing of the first page remains but the written tab state.
    const saved = parseRoomState(JSON.parse(written))!;
    const record = createRoomRecord([...saved.conversation], saved.delivered, (speaker) => speaker, () => {}, saved.sent, () => 0, saved.addressed);
    const after = createAnswerChannel({
      restored: saved.turns,
      delivered: (session, count) => record.markDelivered(session, count),
      restoredAnswer: (token, text) => record.append(token.member, text),
      changed: () => {},
    });
    expect(after.deliver({ turn: "t-1", status: "settled", text: "done" })).toEqual({ turn: "t-1", next: ANSWER_NEXT });
    expect(record.delivered()).toEqual({ "s-1": 1 });
    expect(record.lines.at(-1)).toMatchObject({ speaker: "m", text: "done" });
    expect(after.tokens()).toEqual([]);
  });
});

// The reply of an accepted answer is the last text that the member reads in its turn, so it tells the member to stop without
// terminal text (C124).
describe("the reply of an accepted answer", () => {
  it("tells the member that the turn ended and that it writes nothing in its terminal", () => {
    expect(ANSWER_NEXT).toBe("The room has your answer and your turn ended. Nobody reads your terminal: end now with the single text . and nothing else.");
  });
});
