// The answer channel of the room (docs/spec/room.md#answer): each relayed line carries the token of its turn, a member delivers its
// answer with the declared command soksak-plugin-agents-clubhouse.answer {turn, text}, and the room accepts each token once, only
// while its turn is open.
import { describe, expect, it } from "vitest";
import { ANSWER_COMMAND, createAnswerChannel } from "./answer";

const counter = () => {
  let next = 0;
  return () => `t-${++next}`;
};

describe("createAnswerChannel", () => {
  it("resolves the open turn of the token with the delivered text, whole and unchanged", async () => {
    const channel = createAnswerChannel(counter());
    const turn = channel.open("s-1");
    expect(turn.turn).toBe("t-1");
    const text = Array.from({ length: 451 }, (_, index) => `row ${index}`).join("\n");
    expect(channel.deliver({ turn: "t-1", text })).toEqual({ turn: "t-1" });
    await expect(turn.answer).resolves.toBe(text);
  });

  it("refuses a token of no open turn, also a second answer of one turn and an answer after the close of its turn", () => {
    const channel = createAnswerChannel(counter());
    expect(() => channel.deliver({ turn: "t-9", text: "hi" })).toThrow("turn t-9 is not an open turn of this room");
    channel.open("s-1");
    channel.deliver({ turn: "t-1", text: "first" });
    expect(() => channel.deliver({ turn: "t-1", text: "second" })).toThrow("turn t-1 is not an open turn of this room");
    channel.open("s-1").close();
    expect(() => channel.deliver({ turn: "t-2", text: "late" })).toThrow("turn t-2 is not an open turn of this room");
  });

  it("gives each turn its own token, so the answer of one member never ends the turn of another", async () => {
    const channel = createAnswerChannel(counter());
    const first = channel.open("s-1");
    const second = channel.open("s-2");
    channel.deliver({ turn: second.turn, text: "of s-2" });
    channel.deliver({ turn: first.turn, text: "of s-1" });
    await expect(first.answer).resolves.toBe("of s-1");
    await expect(second.answer).resolves.toBe("of s-2");
  });

  it("refuses invalid parameters with the parameter and the value", () => {
    const channel = createAnswerChannel(counter());
    channel.open("s-1");
    expect(() => channel.deliver({ turn: "", text: "x" })).toThrow('turn must be a non-empty string, got ""');
    expect(() => channel.deliver({ turn: "t-1", text: "  " })).toThrow('text must be a non-empty string, got "  "');
    expect(() => channel.deliver({ turn: "t-1", text: 3 })).toThrow("text must be a non-empty string, got 3");
  });

  it("refuses a second open turn of one session", () => {
    const channel = createAnswerChannel(counter());
    channel.open("s-1");
    expect(() => channel.open("s-1")).toThrow("session s-1 has an open turn");
  });

  it("names the declared command", () => {
    expect(ANSWER_COMMAND).toBe("soksak-plugin-agents-clubhouse.answer");
  });
});
