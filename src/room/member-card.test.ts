// The values of the member cards (C123, docs/spec/room.md#header): initials, state and count.
import { describe, expect, it } from "vitest";
import { initialsOf, memberCount, memberState } from "./member-card";

describe("initialsOf", () => {
  it("takes the first character of the first two words, or the first two characters of one word, in upper case", () => {
    expect(initialsOf("manager spec")).toBe("MS");
    expect(initialsOf("  Code   Reviewer  Lead ")).toBe("CR");
    expect(initialsOf("codex")).toBe("CO");
    expect(initialsOf("기획자")).toBe("기획");
    expect(initialsOf("x")).toBe("X");
    expect(initialsOf("😀smile")).toBe("😀S");
    expect(initialsOf("")).toBe("");
  });
});

describe("memberState", () => {
  it("is none without an open session, answering while an answer is awaited, and idle otherwise", () => {
    expect(memberState(false, false)).toBe("none");
    expect(memberState(false, true)).toBe("none");
    expect(memberState(true, true)).toBe("answering");
    expect(memberState(true, false)).toBe("idle");
  });

});

describe("memberCount", () => {
  it("counts the checked members over the members and leaves out the entries that are no member", () => {
    expect(memberCount([{ member: true, checked: true }, { member: true, checked: false }, { member: false, checked: false }])).toEqual({ checked: 1, members: 2 });
    expect(memberCount([])).toEqual({ checked: 0, members: 0 });
  });
});
