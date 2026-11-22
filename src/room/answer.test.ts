// The answer channel of the room (docs/spec/room.md#answer): each relayed line carries the token of its turn, a member delivers its
// answer with the declared command soksak-plugin-agents-clubhouse.answer {turn, text}, and the room accepts each token once, only
// while its turn is open.
import { describe, expect, it } from "vitest";
import { ANSWER_COMMAND, RECORD_ACK_COMMAND, createAnswerChannel, type OpenToken } from "./answer";

const counter = () => {
  let next = 0;
  return () => `t-${++next}`;
};

describe("createAnswerChannel", () => {
  it("resolves the open turn of the token with the delivered text, whole and unchanged", async () => {
    const channel = createAnswerChannel({ newTurn: counter(), delivered: () => {}, restoredAnswer: () => {}, changed: () => {} });
    const turn = channel.open("s-1", "m", "answer", 0);
    expect(turn.turn).toBe("t-1");
    const text = Array.from({ length: 451 }, (_, index) => `row ${index}`).join("\n");
    expect(channel.deliver({ turn: "t-1", text })).toEqual({ turn: "t-1" });
    await expect(turn.answer).resolves.toBe(text);
  });

  it("refuses a token of no open turn, also a second answer of one turn and an answer after the close of its turn", () => {
    const channel = createAnswerChannel({ newTurn: counter(), delivered: () => {}, restoredAnswer: () => {}, changed: () => {} });
    expect(() => channel.deliver({ turn: "t-9", text: "hi" })).toThrow("turn t-9 is not an open turn of this room");
    channel.open("s-1", "m", "answer", 0);
    channel.deliver({ turn: "t-1", text: "first" });
    expect(() => channel.deliver({ turn: "t-1", text: "second" })).toThrow("turn t-1 is not an open turn of this room");
    channel.open("s-1", "m", "answer", 0).close();
    expect(() => channel.deliver({ turn: "t-2", text: "late" })).toThrow("turn t-2 is not an open turn of this room");
  });

  it("gives each turn its own token, so the answer of one member never ends the turn of another", async () => {
    const channel = createAnswerChannel({ newTurn: counter(), delivered: () => {}, restoredAnswer: () => {}, changed: () => {} });
    const first = channel.open("s-1", "m", "answer", 0);
    const second = channel.open("s-2", "m", "answer", 0);
    channel.deliver({ turn: second.turn, text: "of s-2" });
    channel.deliver({ turn: first.turn, text: "of s-1" });
    await expect(first.answer).resolves.toBe("of s-1");
    await expect(second.answer).resolves.toBe("of s-2");
  });

  it("refuses invalid parameters with the parameter and the value", () => {
    const channel = createAnswerChannel({ newTurn: counter(), delivered: () => {}, restoredAnswer: () => {}, changed: () => {} });
    channel.open("s-1", "m", "answer", 0);
    expect(() => channel.deliver({ turn: "", text: "x" })).toThrow('turn must be a non-empty string, got ""');
    expect(() => channel.deliver({ turn: "t-1", text: "  " })).toThrow('text must be a non-empty string, got "  "');
    expect(() => channel.deliver({ turn: "t-1", text: 3 })).toThrow("text must be a non-empty string, got 3");
  });

  it("refuses a second open turn of one session", () => {
    const channel = createAnswerChannel({ newTurn: counter(), delivered: () => {}, restoredAnswer: () => {}, changed: () => {} });
    channel.open("s-1", "m", "answer", 0);
    expect(() => channel.open("s-1", "m", "answer", 0)).toThrow("session s-1 has an open turn");
  });

  it("names the declared command", () => {
    expect(ANSWER_COMMAND).toBe("soksak-plugin-agents-clubhouse.answer");
  });

  it("raises the delivered number of the session to the count of the token only when its answer or acknowledgement arrives", async () => {
    const raised: string[] = [];
    const channel = createAnswerChannel({ newTurn: counter(), delivered: (session, count) => void raised.push(`${session}=${count}`), restoredAnswer: () => {}, changed: () => {} });
    const turn = channel.open("s-1", "a", "answer", 3);
    const record = channel.open("s-2", "b", "record", 4);
    expect(raised).toEqual([]);
    channel.deliver({ turn: turn.turn, text: "hi" });
    expect(channel.ack({ turn: record.turn })).toEqual({ turn: record.turn });
    await expect(record.answer).resolves.toBe("");
    expect(raised).toEqual(["s-1=3", "s-2=4"]);
  });

  it("refuses an answer of a record token and an acknowledgement of a turn token, each with the command to run", () => {
    const channel = createAnswerChannel({ newTurn: counter(), delivered: () => {}, restoredAnswer: () => {}, changed: () => {} });
    channel.open("s-1", "a", "answer", 1);
    channel.open("s-2", "b", "record", 1);
    expect(() => channel.deliver({ turn: "t-2", text: "x" })).toThrow(`turn t-2 is a record line: acknowledge it with ${RECORD_ACK_COMMAND}`);
    expect(() => channel.ack({ turn: "t-1" })).toThrow(`turn t-1 is a turn: answer it with ${ANSWER_COMMAND}`);
    expect(() => channel.ack({ turn: "t-9" })).toThrow("turn t-9 is not an open record line of this room");
  });

  it("accepts the tokens of the tab state after a restart: an answer is the answer of its member, and both raise the delivered number", () => {
    const raised: string[] = [];
    const answered: string[] = [];
    const restored: OpenToken[] = [
      { turn: "old-1", session: "s-1", member: "a", kind: "answer", count: 2 },
      { turn: "old-2", session: "s-2", member: "b", kind: "record", count: 3 },
    ];
    const channel = createAnswerChannel({
      newTurn: counter(),
      restored,
      delivered: (session, count) => void raised.push(`${session}=${count}`),
      restoredAnswer: (token, text) => void answered.push(`${token.member}:${text}`),
      changed: () => {},
    });
    expect(channel.tokens()).toEqual(restored);
    channel.deliver({ turn: "old-1", text: "late answer" });
    channel.ack({ turn: "old-2" });
    expect(raised).toEqual(["s-1=2", "s-2=3"]);
    expect(answered).toEqual(["a:late answer"]);
    expect(channel.tokens()).toEqual([]);
  });

  it("closes the record tokens and the restored tokens, and keeps the tokens of a running relay", () => {
    const channel = createAnswerChannel({
      newTurn: counter(),
      restored: [{ turn: "old-1", session: "s-3", member: "c", kind: "answer", count: 0 }],
      delivered: () => {},
      restoredAnswer: () => {},
      changed: () => {},
    });
    channel.open("s-1", "a", "answer", 0);
    channel.open("s-2", "b", "record", 0);
    expect(channel.closeWaits().map((token) => token.turn)).toEqual(["old-1", "t-2"]);
    expect(channel.tokens().map((token) => token.turn)).toEqual(["t-1"]);
  });
});
