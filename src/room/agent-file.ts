// The agent name of an agent file (docs/spec/room.md#group): the `name` of its YAML frontmatter, by which Claude Code finds a project
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

// The reply of runtime.program.run (core docs/spec/native-surfaces.md#program-runs): `truncated` names each stream that discarded bytes.
export interface ProgramReply { code: number; stdout: string; stderr: string; truncated: { stdout: boolean; stderr: boolean } }

// The text of the agent file from the reply of the program agent-file: a run that failed or discarded bytes of a stream is refused.
export function agentFileText(reply: ProgramReply, file: string): string {
  if (reply.code !== 0) throw new Error(`agent file ${file}: agent-file exited with ${reply.code}: ${reply.stderr.trim()}`);
  const cut = (["stdout", "stderr"] as const).filter((stream) => reply.truncated[stream]);
  if (cut.length > 0) throw new Error(`agent file ${file}: agent-file output was truncated: ${cut.join(", ")}`);
  return reply.stdout;
}

// The agent file of a definition: the first file of its role in core.roles, because the role identifier of a definition equals its
// identifier; null when core.roles lists no file for it (docs/spec/room.md#group).
export function roleFileOf(id: string, roles: unknown): string | null {
  const list = roles !== null && typeof roles === "object" && !Array.isArray(roles) ? (roles as { roles?: unknown }).roles : undefined;
  if (!Array.isArray(list) || !list.every((role) => role !== null && typeof role === "object" && typeof role.id === "string" && Array.isArray(role.files))) {
    throw new Error("core.roles: the value is not {seq, roles: [{id, text, ko, files}]}");
  }
  const file = (list as { id: string; files: unknown[] }[]).find((role) => role.id === id)?.files[0];
  return typeof file === "string" ? file : null;
}
