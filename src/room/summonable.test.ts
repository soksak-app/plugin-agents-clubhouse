// The definitions that the leader can summon (C94, docs/spec/room.md#team): the roster source, the agents definitions, with the groups
// of the agents data and the agent file that core.roles gives for the role of each definition.
import { describe, expect, it } from "vitest";
import { summonableDefinitions } from "./summonable";

const DEFINITIONS = [
  { id: "moai-e2e-tester", name: "e2e-tester", plugin: "terminal" },
  { id: "solo", name: "Solo", plugin: "terminal" },
];

describe("summonableDefinitions", () => {
  it("lists each definition with its plugin, its groups and the file of its role, null without one", () => {
    const groups = { moai: { name: "MoAI", members: ["moai-e2e-tester"] }, qa: { name: "QA", members: ["moai-e2e-tester"] } };
    const roles = { seq: 3, roles: [{ id: "moai-e2e-tester", text: "t", ko: "k", files: ["/p/.claude/agents/moai/e2e-tester.md"] }, { id: "solo", text: "t", ko: "k", files: [] }] };
    expect(summonableDefinitions(DEFINITIONS, groups, roles)).toEqual([
      { id: "moai-e2e-tester", name: "e2e-tester", plugin: "terminal", groups: ["MoAI", "QA"], file: "/p/.claude/agents/moai/e2e-tester.md" },
      { id: "solo", name: "Solo", plugin: "terminal", groups: [], file: null },
    ]);
  });

  it("gives file null for a definition whose role core.roles does not list, and reads absent groups as none", () => {
    expect(summonableDefinitions(DEFINITIONS.slice(1), undefined, { seq: 0, roles: [] })).toEqual([{ id: "solo", name: "Solo", plugin: "terminal", groups: [], file: null }]);
  });

  it("refuses a groups value or a core.roles value of another form", () => {
    expect(() => summonableDefinitions(DEFINITIONS, [], { seq: 0, roles: [] })).toThrow("agents project data groups: the value is not an object of group identifier to {name, members}");
    expect(() => summonableDefinitions(DEFINITIONS, {}, { roles: "x" })).toThrow("core.roles: the value is not {seq, roles: [{id, text, ko, files}]}");
  });
});
