// The mention hint of the composer (C102, docs/spec/room.md#mention-hint): the word before the caret that starts with `@`, the members
// whose name starts with its text, and the text after a choice.
import { describe, expect, it } from "vitest";
import { insertMention, mentionCandidates, mentionQuery } from "./mention-hint";

const MEMBERS = [
  { id: "moai-manager-lead", name: "manager-lead" },
  { id: "moai-manager-develop-1", name: "manager-develop-1" },
  { id: "harness", name: "Harness" },
];

describe("mentionQuery", () => {
  it("finds the @ word that ends at the caret, at the start of the text or after a space", () => {
    expect(mentionQuery("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionQuery("hi @man", 7)).toEqual({ start: 3, query: "man" });
    expect(mentionQuery("hi\n@ha", 6)).toEqual({ start: 3, query: "ha" });
  });

  it("finds no word in an address, after a space that ends the word, or before the caret of another word", () => {
    expect(mentionQuery("mail@man", 8)).toBeNull();
    expect(mentionQuery("@man ", 5)).toBeNull();
    expect(mentionQuery("hello", 5)).toBeNull();
  });
});

describe("mentionCandidates", () => {
  it("lists every member and all for an empty query, all first", () => {
    expect(mentionCandidates(MEMBERS, "")).toEqual(["all", "manager-lead", "manager-develop-1", "Harness"]);
  });

  it("lists the names that start with the query, compared without case", () => {
    expect(mentionCandidates(MEMBERS, "MAN")).toEqual(["manager-lead", "manager-develop-1"]);
    expect(mentionCandidates(MEMBERS, "a")).toEqual(["all"]);
    expect(mentionCandidates(MEMBERS, "zz")).toEqual([]);
  });
});

describe("insertMention", () => {
  it("replaces the @ word with the chosen name and a space, and puts the caret after them", () => {
    expect(insertMention("hi @man rest", 7, 3, "manager-lead")).toEqual({ text: "hi @manager-lead  rest", caret: 17 });
    expect(insertMention("@", 1, 0, "all")).toEqual({ text: "@all ", caret: 5 });
  });
});
