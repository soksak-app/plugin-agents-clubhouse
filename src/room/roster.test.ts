// The roster of the room (C3, C34): one entry per agent definition, in the order of the definitions. A definition that the agents
// data no longer lists leaves the roster; a new one joins unchecked, because inviting a member is the choice of the person.
import { describe, expect, it } from "vitest";
import { reattachedChecks, rosterFrom } from "./roster";
import type { AgentDefinition } from "./definitions";

const def = (id: string, name = id.toUpperCase()): AgentDefinition => ({
  id, name, account: "claude-main", plugin: "terminal", program: "claude", args: [], role: id, cwd: "/work",
});

describe("rosterFrom", () => {
  it("lists each definition with its name, all unchecked when there is no earlier roster", () => {
    expect(rosterFrom([def("a"), def("b", "Writer")], [])).toEqual([
      { id: "a", name: "A", checked: false, role: "", leader: false },
      { id: "b", name: "Writer", checked: false, role: "", leader: false },
    ]);
  });

  it("keeps the checked state and the order of the earlier roster, drops a removed definition, and adds a new one unchecked", () => {
    const previous = [
      { id: "b", name: "B", checked: false, role: "", leader: false },
      { id: "gone", name: "Gone", checked: true, role: "", leader: false },
      { id: "a", name: "A", checked: true, role: "", leader: true },
    ];
    expect(rosterFrom([def("a"), def("b"), def("c")], previous)).toEqual([
      { id: "b", name: "B", checked: false, role: "", leader: false },
      { id: "a", name: "A", checked: true, role: "", leader: true },
      { id: "c", name: "C", checked: false, role: "", leader: false },
    ]);
  });

  it("refuses duplicate definition identifiers, with the text of the rule", () => {
    expect(() => rosterFrom([def("a"), def("a")], [])).toThrow("agent definition identifiers must be unique: a");
  });
});

// A room tab without a state (docs/spec/room.md#restart): the members whose stored session core.sessions lists with this room as
// owner are checked, so the room reattaches to its own sessions; every other member stays unchecked.
describe("reattachedChecks", () => {
  it("checks the definitions whose stored session is an owned open session", async () => {
    const stored: Record<string, string> = { a: "s-1", b: "s-gone", c: "s-3" };
    const checks = await reattachedChecks(
      [def("a"), def("b"), def("c"), def("d")],
      async (id) => stored[id] ?? null,
      new Set(["s-1", "s-3", "s-other"]),
    );
    expect(checks).toEqual([
      { id: "a", name: "", checked: true, role: "", leader: false },
      { id: "b", name: "", checked: false, role: "", leader: false },
      { id: "c", name: "", checked: true, role: "", leader: false },
      { id: "d", name: "", checked: false, role: "", leader: false },
    ]);
  });
});
