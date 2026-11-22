// The mentions of a room message (docs/spec/room.md#mentions): only the mentioned members receive a message that mentions members,
// in the order of their first mention.
import { describe, expect, it } from "vitest";
import { mentionedMembers } from "./mention";

const members = [
  { id: "reviewer", name: "Claude", session: "s-1" },
  { id: "writer", name: "Codex", session: "s-2" },
  { id: "tester", name: "Test-bot", session: "s-3" },
];

describe("mentionedMembers", () => {
  it("returns no member for a message without a mention", () => {
    expect(mentionedMembers("hello all", members)).toEqual([]);
  });

  it("matches a name or an identifier without case, in the order of the first mention", () => {
    expect(mentionedMembers("@codex then @REVIEWER, and @Codex again", members).map((m) => m.id)).toEqual(["writer", "reviewer"]);
  });

  it("keeps - _ and . inside a name and ends a mention at other punctuation", () => {
    expect(mentionedMembers("ask @test-bot: please", members).map((m) => m.id)).toEqual(["tester"]);
  });

  it("treats a mention of no member and an @ inside a word as text", () => {
    expect(mentionedMembers("mail me@claude.dev or @nobody", members)).toEqual([]);
  });
});
