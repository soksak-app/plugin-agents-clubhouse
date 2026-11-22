// The isolation of a member program (docs/spec/room.md#isolation): the room starts each member CLI with the isolation arguments of the
// declared table, so a member reads no personal instructions of the person; a CLI without an entry starts unchanged and is not isolated.
import { describe, expect, it } from "vitest";
import { ISOLATION_ARGS, memberLaunch } from "./isolation";
import { roomProtocolLine } from "./protocol";

describe("memberLaunch", () => {
  it("adds the isolation arguments of claude after its own arguments", () => {
    expect(ISOLATION_ARGS.claude).toEqual(["--setting-sources", "project,local"]);
    expect(memberLaunch("claude", ["--verbose"])).toEqual({ args: ["--verbose", "--setting-sources", "project,local"], isolated: true });
    expect(memberLaunch("/usr/local/bin/claude", [])).toEqual({ args: ["--setting-sources", "project,local"], isolated: true });
  });

  it("starts a CLI without an entry unchanged and reports it as not isolated", () => {
    expect(memberLaunch("othercli", ["-x"])).toEqual({ args: ["-x"], isolated: false });
  });

  it("gives an isolated member the shell forms only, because the user-scope MCP servers are not loaded", () => {
    const line = roomProtocolLine("Claude", [], "room-1", "", false);
    expect(line).toContain("sok soksak-plugin-agents-clubhouse.answer --surface room-1");
    expect(line).not.toContain("command_run");
  });
});
