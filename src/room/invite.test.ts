// The invite dialog values (C120, docs/spec/room.md#invite): params, their reader, the tree rows and the invited identifiers.
import { describe, expect, it } from "vitest";
import { inviteGroups, inviteParams, invitedIds, parseInviteParams } from "./invite";

const roster = [
  { id: "a", name: "A", member: true },
  { id: "b", name: "B", member: false },
  { id: "c", name: "C", member: false },
  { id: "d", name: "D", member: false },
];
const groups = { "g-2": { name: "Two", members: ["c", "a"] }, "g-1": { name: "One", members: ["a", "gone"] } };

describe("inviteParams", () => {
  it("lists the roster entries, the groups in identifier order and the members", () => {
    expect(inviteParams(roster, groups)).toEqual({
      definitions: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }, { id: "d", name: "D" }],
      groups: [{ id: "g-1", name: "One", members: ["a", "gone"] }, { id: "g-2", name: "Two", members: ["c", "a"] }],
      members: ["a"],
    });
    expect(inviteParams(roster, undefined).groups).toEqual([]);
  });

  it("refuses stored groups of another form", () => {
    expect(() => inviteParams(roster, { g: { name: "G" } })).toThrow("agents project data groups: the value is not an object of group identifier to {name, members}");
    expect(() => inviteParams(roster, [])).toThrow("agents project data groups");
  });
});

describe("parseInviteParams", () => {
  it("reads the form that inviteParams gives and refuses another, naming the field", () => {
    const params = inviteParams(roster, groups);
    expect(parseInviteParams(JSON.parse(JSON.stringify(params)))).toEqual(params);
    expect(() => parseInviteParams(null)).toThrow("invite params: the value must be {definitions, groups, members}, got null");
    expect(() => parseInviteParams({ ...params, extra: 1 })).toThrow("invite params: unknown field extra");
    expect(() => parseInviteParams({ ...params, definitions: [{ id: "" , name: "x" }] })).toThrow("invite params: definitions must be an array of {id, name}");
    expect(() => parseInviteParams({ ...params, groups: [{ id: "g", name: "G" }] })).toThrow("invite params: groups must be an array of {id, name, members}");
    expect(() => parseInviteParams({ ...params, members: [1] })).toThrow("invite params: members must be an array of identifiers, got [1]");
  });
});

describe("inviteGroups", () => {
  it("lists each group with its definitions, leaves out unknown members and ends with the definitions in no group", () => {
    expect(inviteGroups(inviteParams(roster, groups))).toEqual([
      { name: "One", rows: [{ id: "a", name: "A", member: true }] },
      { name: "Two", rows: [{ id: "c", name: "C", member: false }, { id: "a", name: "A", member: true }] },
      { name: null, rows: [{ id: "b", name: "B", member: false }, { id: "d", name: "D", member: false }] },
    ]);
    expect(inviteGroups(inviteParams([{ id: "a", name: "A", member: false }], { g: { name: "G", members: ["a"] } }))).toEqual([
      { name: "G", rows: [{ id: "a", name: "A", member: false }] },
    ]);
  });
});

describe("invitedIds", () => {
  it("gives the picked definitions that are no member, in roster order", () => {
    const params = inviteParams(roster, groups);
    expect(invitedIds(params, new Set(["d", "a", "b"]))).toEqual(["b", "d"]);
    expect(invitedIds(params, new Set())).toEqual([]);
  });
});
