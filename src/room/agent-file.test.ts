// The agent name of an agent file (C97-1, docs/spec/room.md#group): the `name` of its YAML frontmatter, by which Claude Code finds the agent.
import { describe, expect, it } from "vitest";
import { agentFileText, agentNameOf, roleFileOf } from "./agent-file";

const FILE = "/p/.claude/agents/moai/manager-develop.md";

describe("agentNameOf", () => {
  it("reads the name of the frontmatter, as the moai agent files declare it", () => {
    expect(agentNameOf("---\nname: manager-develop\ndescription: |\n  Unified implementation specialist.\n---\nBody\n", FILE)).toBe("manager-develop");
  });
  it("refuses a file without a frontmatter, without a name, or with a name that is not a text", () => {
    expect(() => agentNameOf("# no frontmatter\n", FILE)).toThrow(`agent file ${FILE} has no frontmatter`);
    expect(() => agentNameOf("---\ndescription: x\n---\n", FILE)).toThrow(`agent file ${FILE} has no name in its frontmatter`);
    expect(() => agentNameOf("---\nname: [a]\n---\n", FILE)).toThrow(`agent file ${FILE} has no name in its frontmatter`);
    expect(() => agentNameOf("---\nname: : :\n---\n", FILE)).toThrow(`agent file ${FILE}: frontmatter`);
  });
});

// C97-3: the reply of runtime.program.run has `truncated: {stdout, stderr}` (core docs/spec/native-surfaces.md#program-runs).
describe("agentFileText", () => {
  const text = "---\nname: manager-develop\n---\n" + "x".repeat(19000);
  it("reads the output of a clean run", () => {
    expect(agentFileText({ code: 0, stdout: text, stderr: "", truncated: { stdout: false, stderr: false } }, FILE)).toBe(text);
  });
  it("refuses a run that failed or discarded bytes of a stream", () => {
    expect(() => agentFileText({ code: 1, stdout: "", stderr: "cat: x: No such file\n", truncated: { stdout: false, stderr: false } }, FILE))
      .toThrow(`agent file ${FILE}: agent-file exited with 1: cat: x: No such file`);
    expect(() => agentFileText({ code: 0, stdout: text, stderr: "", truncated: { stdout: true, stderr: false } }, FILE))
      .toThrow(`agent file ${FILE}: agent-file output was truncated: stdout`);
    expect(() => agentFileText({ code: 0, stdout: text, stderr: "", truncated: { stdout: false, stderr: true } }, FILE))
      .toThrow(`agent file ${FILE}: agent-file output was truncated: stderr`);
  });
});

describe("roleFileOf", () => {
  it("gives the first file of the role of the definition, null without one, and refuses core.roles of another form", () => {
    const roles = { seq: 3, roles: [{ id: "moai-e2e-tester", text: "t", ko: "k", files: ["/p/.claude/agents/moai/e2e-tester.md"] }, { id: "solo", text: "t", ko: "k", files: [] }] };
    expect(roleFileOf("moai-e2e-tester", roles)).toBe("/p/.claude/agents/moai/e2e-tester.md");
    expect(roleFileOf("solo", roles)).toBeNull();
    expect(roleFileOf("absent", roles)).toBeNull();
    expect(() => roleFileOf("solo", { roles: "x" })).toThrow("core.roles: the value is not {seq, roles: [{id, text, ko, files}]}");
  });
});
