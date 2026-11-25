// The members of a room are the members of its assigned group of the agents plugin (docs/spec/room.md#group).
import { describe, expect, it } from "vitest";
import { groupMembers, readGroups } from "./members";

const definition = (id: string, name: string) => ({ id, name, account: "a", plugin: "terminal", program: "claude", args: [], home: null, launch: null, role: id, cwd: "/w" });

describe("readGroups (docs/spec/room.md#group)", () => {
  it("reads each group with its name, members and leader, and an absent value as no groups", () => {
    const value = { g1: { name: "Team", members: ["a", "b"], leader: "b" }, g2: { name: "Empty", members: [], leader: null } };
    expect(readGroups(value)).toEqual(value);
    expect(readGroups(undefined)).toEqual({});
  });

  it("refuses a group of another form, a group with members and no leader, and a leader that is no member", () => {
    expect(() => readGroups({ g1: { name: "Team", members: ["a"] } })).toThrow('agents project data groups: group g1 must be {name, members, leader}, got {"name":"Team","members":["a"]}');
    expect(() => readGroups({ g1: { name: "Team", members: ["a"], leader: null } })).toThrow("agents project data groups: group g1 has members and no leader");
    expect(() => readGroups({ g1: { name: "Team", members: ["a"], leader: "b" } })).toThrow("agents project data groups: group g1 has the leader b, which is not a member");
    expect(() => readGroups([])).toThrow("agents project data groups: the value is not an object of group identifier to {name, members, leader}");
  });
});

describe("groupMembers (docs/spec/room.md#group)", () => {
  const groups = { g1: { name: "Team", members: ["b", "gone", "a"], leader: "a" } };
  const definitions = [definition("a", "Alpha"), definition("b", "Beta")];

  it("lists the members of the assigned group in group order with the leader, and reports a member without a definition", () => {
    const reports: string[] = [];
    expect(groupMembers(definitions, groups, "g1", (text) => reports.push(text))).toEqual([
      { id: "b", name: "Beta", leader: false },
      { id: "a", name: "Alpha", leader: true },
    ]);
    expect(reports).toEqual(["group g1 member gone has no definition"]);
  });

  it("has no members without an assigned group or for a group that the agents plugin no longer stores", () => {
    expect(groupMembers(definitions, groups, null, () => {})).toEqual([]);
    expect(groupMembers(definitions, groups, "g9", () => {})).toEqual([]);
  });
});
