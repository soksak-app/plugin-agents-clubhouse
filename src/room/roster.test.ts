// The roster of the room (C3, C34): one entry per agent definition, in the order of the definitions. A definition that the agents
// data no longer lists leaves the roster; a new one joins as no member, because inviting a member is the choice of the person.
import { describe, expect, it } from "vitest";
import { reattachedChecks, rosterFrom } from "./roster";
import type { AgentDefinition } from "./definitions";

const def = (id: string, name = id.toUpperCase()): AgentDefinition => ({
  id, name, account: "claude-main", plugin: "terminal", program: "claude", args: [], home: null, launch: null, role: id, cwd: "/work",
});

describe("rosterFrom", () => {
  it("lists each definition with its name, none a member when there is no earlier roster", () => {
    expect(rosterFrom([def("a"), def("b", "Writer")], [])).toEqual([
      { id: "a", name: "A", member: false, checked: false, role: "", leader: false },
      { id: "b", name: "Writer", member: false, checked: false, role: "", leader: false },
    ]);
  });

  it("keeps the membership, the checked state and the order of the earlier roster, drops a removed definition, and adds a new one as no member", () => {
    const previous = [
      { id: "b", name: "B", member: true, checked: false, role: "", leader: false },
      { id: "gone", name: "Gone", member: true, checked: true, role: "", leader: false },
      { id: "a", name: "A", member: true, checked: true, role: "", leader: true },
    ];
    expect(rosterFrom([def("a"), def("b"), def("c")], previous)).toEqual([
      { id: "b", name: "B", member: true, checked: false, role: "", leader: false },
      { id: "a", name: "A", member: true, checked: true, role: "", leader: true },
      { id: "c", name: "C", member: false, checked: false, role: "", leader: false },
    ]);
  });

  it("refuses duplicate definition identifiers, with the text of the rule", () => {
    expect(() => rosterFrom([def("a"), def("a")], [])).toThrow("agent definition identifiers must be unique: a");
  });
});

// A room tab without a state (docs/spec/room.md#restart): the members whose stored session core.sessions lists with this room as
// owner are checked members, so the room reattaches to its own sessions; every other definition is no member.
describe("reattachedChecks", () => {
  it("checks the definitions whose stored session is an owned open session", async () => {
    const stored: Record<string, string> = { a: "s-1", b: "s-gone", c: "s-3" };
    const checks = await reattachedChecks(
      [def("a"), def("b"), def("c"), def("d")],
      async (id) => stored[id] ?? null,
      new Set(["s-1", "s-3", "s-other"]),
    );
    expect(checks).toEqual([
      { id: "a", name: "", member: true, checked: true, role: "", leader: false },
      { id: "b", name: "", member: false, checked: false, role: "", leader: false },
      { id: "c", name: "", member: true, checked: true, role: "", leader: false },
      { id: "d", name: "", member: false, checked: false, role: "", leader: false },
    ]);
  });
});
