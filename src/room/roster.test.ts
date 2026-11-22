// The roster of the room (C3): one entry per agent definition, in the order of the definitions, each checked unless the person
// unchecked it. A definition that the status no longer lists leaves the roster; a new one is checked.
import { describe, expect, it } from "vitest";
import { rosterFrom } from "./roster";
import type { AgentDefinition } from "./definitions";

const def = (id: string, name = id.toUpperCase()): AgentDefinition => ({
  id, name, account: "claude-main", plugin: "terminal", program: "claude", args: [], role: id, cwd: "/work",
});

describe("rosterFrom", () => {
  it("lists each definition with its name, all checked when there is no earlier roster", () => {
    expect(rosterFrom([def("a"), def("b", "Writer")], [])).toEqual([
      { id: "a", name: "A", checked: true },
      { id: "b", name: "Writer", checked: true },
    ]);
  });

  it("keeps the checked state and the order of the earlier roster, drops a removed definition, and checks a new one", () => {
    const previous = [
      { id: "b", name: "B", checked: false },
      { id: "gone", name: "Gone", checked: true },
      { id: "a", name: "A", checked: true },
    ];
    expect(rosterFrom([def("a"), def("b"), def("c")], previous)).toEqual([
      { id: "b", name: "B", checked: false },
      { id: "a", name: "A", checked: true },
      { id: "c", name: "C", checked: true },
    ]);
  });

  it("refuses duplicate definition identifiers, with the text of the rule", () => {
    expect(() => rosterFrom([def("a"), def("a")], [])).toThrow("agent definition identifiers must be unique: a");
  });
});
