// The login of the account home of a member (C130, docs/spec/room.md#login): the declared status program of the CLI in the home, the
// reading of its reply, the members whose home has no login, and the session that opens the login of the account.
import { describe, expect, it } from "vitest";
import manifest from "../../plugin.json";
import type { AgentDefinition } from "./definitions";
import { createLoginGate, loginCheck, loginOf, loginSession, membersWithoutLogin } from "./login";

const CLAUDE_HOME = { variable: "CLAUDE_CONFIG_DIR", folder: "/c/plugin-data/agents/accounts/claude-main" };
const CODEX_HOME = { variable: "CODEX_HOME", folder: "/c/plugin-data/agents/accounts/codex-main" };
const base = { plugin: "terminal", args: [], launch: null, role: "", cwd: "/work" };
const REVIEWER: AgentDefinition = { ...base, id: "reviewer", name: "Reviewer", account: "claude-main", program: "claude", home: CLAUDE_HOME };
const DESIGNER: AgentDefinition = { ...base, id: "designer", name: "Designer", account: "claude-main", program: "claude", home: CLAUDE_HOME };
const WRITER: AgentDefinition = { ...base, id: "writer", name: "Writer", account: "codex-main", program: "/opt/bin/codex", home: CODEX_HOME };
const PLAIN: AgentDefinition = { ...base, id: "plain", name: "Plain", account: "gemini", program: "gemini", home: null };

// The reply of a declared program, and the status JSON that claude auth status --json prints for a home (claude 2.1.331).
const reply = (code: number, stdout = "") => ({ code, stdout, stderr: "", truncated: { stdout: false, stderr: false } });
const claudeStatus = (loggedIn: boolean, configDirectory = CLAUDE_HOME.folder) => JSON.stringify({ loggedIn, authMethod: loggedIn ? "claude.ai" : "none", configDirectory, loginExpiresAt: null });

describe("loginCheck", () => {
  it("runs the documented status command of the CLI in the home of the account, and nothing for an account without a home", () => {
    expect(loginCheck(REVIEWER)).toEqual({ program: "claude-status", args: ["CLAUDE_CONFIG_DIR=/c/plugin-data/agents/accounts/claude-main", "claude", "auth", "status", "--json"] });
    expect(loginCheck(WRITER)).toEqual({ program: "codex-status", args: ["CODEX_HOME=/c/plugin-data/agents/accounts/codex-main", "/opt/bin/codex", "login", "status"] });
    expect(loginCheck(PLAIN)).toBeNull();
  });

  it("refuses a home of a cli that is neither claude nor codex", () => {
    expect(() => loginCheck({ ...PLAIN, home: CLAUDE_HOME })).toThrow("member plain: the cli gemini has no login status command");
  });

  it("gives arguments that the declared status programs accept", () => {
    const programs = (manifest as { programs: Record<string, { program: string; args: (string | { pattern: string })[] }> }).programs;
    for (const check of [loginCheck(REVIEWER)!, loginCheck(WRITER)!]) {
      const program = programs[check.program];
      expect(program.program).toBe("/usr/bin/env");
      expect(check.args).toHaveLength(program.args.length);
      program.args.forEach((rule, i) => {
        if (typeof rule === "string") expect(check.args[i]).toBe(rule);
        else expect(check.args[i]).toMatch(new RegExp(`^(?:${rule.pattern})$`));
      });
    }
  });
});

describe("loginOf", () => {
  it("reads the login of a claude home from its status JSON and of a codex home from its exit status", () => {
    expect(loginOf(REVIEWER, reply(0, claudeStatus(true)))).toBe(true);
    expect(loginOf(REVIEWER, reply(1, claudeStatus(false)))).toBe(false);
    expect(loginOf(WRITER, reply(0, "Logged in using ChatGPT\n"))).toBe(true);
    expect(loginOf(WRITER, reply(1, "Not logged in\n"))).toBe(false);
  });

  it("refuses a status of another configuration folder, a contradicting exit status, output that is not the status JSON, another status and a truncated output", () => {
    expect(() => loginOf(REVIEWER, reply(0, claudeStatus(true, "/Users/person/.claude")))).toThrow(
      "member reviewer: claude reports the configuration folder /Users/person/.claude, not the home /c/plugin-data/agents/accounts/claude-main",
    );
    expect(() => loginOf(REVIEWER, reply(1, claudeStatus(true)))).toThrow("member reviewer: claude-status ended with status 1 and loggedIn true");
    expect(() => loginOf(REVIEWER, reply(0, "not json"))).toThrow("member reviewer: claude-status printed no status JSON");
    expect(() => loginOf(WRITER, reply(2))).toThrow("member writer: codex-status ended with status 2");
    expect(() => loginOf(REVIEWER, { ...reply(0, claudeStatus(true)), truncated: { stdout: true, stderr: false } })).toThrow("member reviewer: claude-status output was truncated");
  });
});

describe("membersWithoutLogin", () => {
  it("reads each home once and gives the members of the homes without a login", async () => {
    const runs: { program: string; args: string[] }[] = [];
    const run = async (program: string, args: string[]) => {
      runs.push({ program, args });
      return program === "claude-status" ? reply(1, claudeStatus(false)) : reply(0);
    };
    expect(await membersWithoutLogin([REVIEWER, DESIGNER, WRITER, PLAIN], run)).toEqual(new Set(["reviewer", "designer"]));
    expect(runs).toEqual([loginCheck(REVIEWER), loginCheck(WRITER)]);
  });

  it("fails with the member of a status that is neither 0 nor 1", async () => {
    await expect(membersWithoutLogin([WRITER], async () => reply(127))).rejects.toThrow("member writer: codex-status ended with status 127");
  });
});

describe("loginSession", () => {
  it("opens the cli of the account in its home and in the working folder of the member, titled by the account", () => {
    expect(loginSession(REVIEWER)).toEqual({ program: "env", args: ["CLAUDE_CONFIG_DIR=/c/plugin-data/agents/accounts/claude-main", "claude"], directory: "/work", title: "claude-main 로그인" });
    expect(loginSession(WRITER)).toEqual({ program: "env", args: ["CODEX_HOME=/c/plugin-data/agents/accounts/codex-main", "/opt/bin/codex", "login"], directory: "/work", title: "codex-main 로그인" });
  });

  it("refuses a member whose account has no home", () => {
    expect(() => loginSession(PLAIN)).toThrow("member plain needs no login");
  });
});

describe("createLoginGate", () => {
  function gateOf(codes: Record<string, number>) {
    const calls: [string, unknown][] = [];
    const gate = createLoginGate({
      definitions: () => [REVIEWER, WRITER, PLAIN],
      run: async (_program, args) => (codes[args[0]] === 0 ? reply(0, claudeStatus(true)) : reply(codes[args[0]], claudeStatus(false))),
      commands: {
        execute: async (name, params) => {
          calls.push([name, params]);
          return name === "core.session.open" ? { session: "s-login" } : {};
        },
      },
      size: async () => ({ width: 800, height: 600, scale: 2 }),
    });
    return { gate, calls };
  }
  const NO_LOGIN = { [loginCheck(REVIEWER)!.args[0]]: 1, [loginCheck(WRITER)!.args[0]]: 0 };

  it("keeps the members of a home without a login out of the summon and names them as needing a login", async () => {
    const { gate } = gateOf(NO_LOGIN);
    expect(await gate.startable([REVIEWER, WRITER, PLAIN])).toEqual(["writer", "plain"]);
    expect(gate.needs("reviewer")).toBe(true);
    expect(gate.needs("writer")).toBe(false);
  });

  it("opens the login of a member that needs one as an owned session in a tab of the current card", async () => {
    const { gate, calls } = gateOf(NO_LOGIN);
    await gate.startable([REVIEWER]);
    expect(await gate.open(REVIEWER)).toEqual({ id: "reviewer", session: "s-login" });
    expect(calls).toEqual([
      ["core.session.open", { plugin: "terminal", params: loginSession(REVIEWER), size: { width: 800, height: 600, scale: 2 } }],
      ["core.layout.open", { card: "current", plugin: "terminal", params: { session: "s-login", title: "claude-main 로그인" } }],
    ]);
  });

  it("refuses the login of a member whose home has a login or whose account has no home", async () => {
    const { gate, calls } = gateOf(NO_LOGIN);
    await gate.startable([REVIEWER, WRITER, PLAIN]);
    await expect(gate.open(WRITER)).rejects.toThrow("member writer needs no login");
    await expect(gate.open(PLAIN)).rejects.toThrow("member plain needs no login");
    expect(calls).toEqual([]);
  });

  it("reports the end of a login session only after core.sessions has listed it", async () => {
    const { gate } = gateOf(NO_LOGIN);
    await gate.startable([REVIEWER]);
    await gate.open(REVIEWER);
    expect(await gate.sessionsChanged([])).toBe(false);
    expect(await gate.sessionsChanged([{ session: "s-login", shownBy: "tab-1", params: null }])).toBe(false);
    expect(await gate.sessionsChanged([])).toBe(true);
    expect(await gate.sessionsChanged([])).toBe(false);
  });

  it("ends a login session whose tab the person closed, so the login is read again", async () => {
    const { gate, calls } = gateOf(NO_LOGIN);
    await gate.startable([REVIEWER]);
    await gate.open(REVIEWER);
    calls.length = 0;
    expect(await gate.sessionsChanged([{ session: "s-login", shownBy: "tab-1", params: null }])).toBe(false);
    expect(await gate.sessionsChanged([{ session: "s-login", shownBy: null, params: null }])).toBe(false);
    expect(calls).toEqual([["core.session.end", { session: "s-login" }]]);
    expect(await gate.sessionsChanged([])).toBe(true);
  });

  it("adopts an owned session that opens the login of a member account, so a login session from before a restart ends with its tab", async () => {
    const { gate, calls } = gateOf(NO_LOGIN);
    const params = loginSession(REVIEWER);
    expect(await gate.sessionsChanged([{ session: "s-old", shownBy: null, params }, { session: "s-member", shownBy: null, params: { program: "claude", args: [] } }])).toBe(false);
    expect(calls).toEqual([["core.session.end", { session: "s-old" }]]);
    expect(await gate.sessionsChanged([{ session: "s-member", shownBy: null, params: { program: "claude", args: [] } }])).toBe(true);
  });
});
