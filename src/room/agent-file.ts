// The agent name of an agent file (docs/spec/room.md#team): the `name` of its YAML frontmatter, by which Claude Code finds a project
// agent for `--agent`. The frontmatter is the text between a first line `---` and the next line `---`; the yaml library parses it.
import { parse } from "yaml";

export function agentNameOf(text: string, file: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (match === null) throw new Error(`agent file ${file} has no frontmatter`);
  let data: unknown;
  try {
    data = parse(match[1]);
  } catch (error) {
    throw new Error(`agent file ${file}: frontmatter ${error instanceof Error ? error.message : String(error)}`);
  }
  const name = data !== null && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>).name : undefined;
  if (typeof name !== "string" || name.trim() === "") throw new Error(`agent file ${file} has no name in its frontmatter`);
  return name.trim();
}
