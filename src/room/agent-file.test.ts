// The agent name of an agent file (C97-1, docs/spec/room.md#team): the `name` of its YAML frontmatter, by which Claude Code finds the agent.
import { describe, expect, it } from "vitest";
import { agentNameOf } from "./agent-file";

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
