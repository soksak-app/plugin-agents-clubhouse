// The mentions of a room message (docs/spec/room.md#mentions): only the mentioned members receive a message that mentions members,
// in the order of their first mention.
import { describe, expect, it } from "vitest";
import { mentionedMembers, mentionsAll } from "./mention";

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

// C95 (docs/spec/room.md#mentions): `@all`, mentions in code and quotes, and mentions followed by Hangul.
describe("mentionsAll and the matching of every mention", () => {
  it("finds @all without case and with a section colon, but not inside a word or a longer word", () => {
    for (const text of ["@all go", "@ALL go", "@all: go", "please @all.", "@all에게 알려"]) expect(mentionsAll(text), text).toBe(true);
    for (const text of ["email@all", "@allison", "@all-hands", "all of you"]) expect(mentionsAll(text), text).toBe(false);
  });
  it("reads no mention inside an inline code span, a fenced code block or a quote line", () => {
    expect(mentionsAll("run `@all` here")).toBe(false);
    expect(mentionsAll("```\n@all\n```")).toBe(false);
    expect(mentionsAll("> @all said")).toBe(false);
    expect(mentionedMembers("`@Claude` and\n```\n@Codex\n```\n> @Test-bot", members)).toEqual([]);
  });
  it("reads a member name followed by Hangul as that member, by the longest name", () => {
    const named = [...members, { id: "harness", name: "harness", session: "s-4" }, { id: "harness-lead", name: "harness-lead", session: "s-5" }];
    expect(mentionedMembers("@harness가 하고 @harness-lead에게 보내", named).map((member) => member.id)).toEqual(["harness", "harness-lead"]);
    expect(mentionedMembers("@Claudeish", named)).toEqual([]);
  });
});
