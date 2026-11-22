// The isolation of a member program from the personal settings of the person (docs/spec/room.md#isolation). A member CLI loads the
// user-level instructions of the person unless its arguments exclude them, so the room starts each member CLI with the isolation
// arguments of this table. A member then reads only the project instructions, the room protocol and its role. A CLI without an entry
// starts unchanged, and the transport status names the member as not isolated.
export const ISOLATION_ARGS: Readonly<Record<string, readonly string[]>> = {
  // `--setting-sources project,local` loads no user settings, no user CLAUDE.md and no user-scope MCP servers; `sok` on PATH stays.
  // `CLAUDE_CODE_SHELL=/bin/bash` through `--settings` makes the Bash tool run bash, so it sources no `~/.zshrc` of the person and
  // takes none of its aliases (docs/spec/room.md#isolation).
  claude: ["--setting-sources", "project,local", "--settings", '{"env":{"CLAUDE_CODE_SHELL":"/bin/bash"}}'],
};

// The arguments that start the member program, and whether the table isolates it; the table entry is named by the base name of program.
export function memberLaunch(program: string, args: readonly string[]): { args: string[]; isolated: boolean } {
  const isolation = ISOLATION_ARGS[program.split("/").at(-1) ?? program];
  return isolation === undefined ? { args: [...args], isolated: false } : { args: [...args, ...isolation], isolated: true };
}
