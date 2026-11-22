// The agent definitions that the room reads from the status agents.definitions of the agents plugin (A13). The room lists agents in
// dependencies (core F1074) and watches the status; each definition becomes a member with the start values of its session.
import { describe, expect, it } from "vitest";
import manifest from "../../plugin.json";
import { parseAgentDefinitions, toMemberDefinition } from "./definitions";

const VALID = [
  { id: "reviewer", name: "Reviewer", account: "claude-main", plugin: "terminal", program: "claude", args: ["--verbose"], role: "reviewer", cwd: "/work/project" },
];

describe("plugin.json lists the agents plugin in dependencies (core F1074)", () => {
  it("declares agents with the range of the versions that the room reads", () => {
    expect(manifest.dependencies).toEqual({ agents: "^0.0.0" });
  });
});

describe("parseAgentDefinitions", () => {
  it("accepts the status value and keeps each definition in the order it has", () => {
    expect(parseAgentDefinitions(VALID)).toEqual(VALID);
    expect(parseAgentDefinitions([])).toEqual([]);
  });

  it("refuses a value that is not a list, and names the status and the member", () => {
    expect(() => parseAgentDefinitions({})).toThrow("agents.definitions status: the value is not a list of definitions");
    expect(() => parseAgentDefinitions([{ ...VALID[0], program: 3 }])).toThrow("agents.definitions status: definition 0 must have the members id, name, account, plugin, program, args, role and cwd");
    expect(() => parseAgentDefinitions([{ ...VALID[0], extra: true }])).toThrow("agents.definitions status: definition 0 must have the members");
  });
});

describe("toMemberDefinition", () => {
  it("gives the start values of the terminal session: program, arguments, directory and role", () => {
    const [definition] = parseAgentDefinitions(VALID);
    expect(toMemberDefinition(definition!)).toEqual({
      id: "reviewer",
      plugin: "terminal",
      params: { program: "claude", args: ["--verbose"], directory: "/work/project", role: "reviewer" },
      cwd: "/work/project",
    });
  });
});
