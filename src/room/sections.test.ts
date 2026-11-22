// The sections of an answer (docs/spec/room.md#sections): one section per addressee in the order of the answer, `@all:` for the rest, and
// no sections for an answer without a section line; the text of the answer stays unchanged.
import { describe, expect, it } from "vitest";
import { answerSections } from "./sections";

const MEMBERS = [{ id: "harness-harness", name: "harness" }, { id: "moai-manager-lead", name: "manager-lead" }];

describe("answerSections", () => {
  it("parses one section per addressed speaker in the order of the answer", () => {
    const text = "@manager-lead: the plan holds\nwith one change\n@owner: done\n@harness: I take the server";
    expect(answerSections(text, MEMBERS)).toEqual([
      { to: "moai-manager-lead", text: "the plan holds\nwith one change" },
      { to: "owner", text: "done" },
      { to: "harness-harness", text: "I take the server" },
    ]);
  });

  it("gives an answer without a section line no sections", () => {
    expect(answerSections("I agree with @harness on the plan.", MEMBERS)).toEqual([]);
  });

  it("parses @all: and gives the text before the first section to all", () => {
    expect(answerSections("Summary first.\n@harness: yes\n@all: next I test", MEMBERS)).toEqual([
      { to: "all", text: "Summary first." },
      { to: "harness-harness", text: "yes" },
      { to: "all", text: "next I test" },
    ]);
  });

  it("keeps a line of an unknown name inside the current section", () => {
    expect(answerSections("@harness: yes\n@nobody: no", MEMBERS)).toEqual([{ to: "harness-harness", text: "yes\n@nobody: no" }]);
  });
});
