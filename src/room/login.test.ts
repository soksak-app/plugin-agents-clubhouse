// The login of the account home of a member (C130, docs/spec/room.md#login): the arguments of the declared program account-login, the
// reading of its exit status, the members whose home has no login, and the session that opens the login of the account.
import { describe, expect, it } from "vitest";
import manifest from "../../plugin.json";
import type { AgentDefinition } from "./definitions";
import { createLoginGate, loginCheckArgs, loginOf, loginSession, membersWithoutLogin } from "./login";

const CLAUDE_HOME = { variable: "CLAUDE_CONFIG_DIR", folder: "/c/plugin-data/agents/accounts/claude-main" };
const CODEX_HOME = { variable: "CODEX_HOME", folder: "/c/plugin-data/agents/accounts/codex-main" };
const base = { plugin: "terminal", args: [], launch: null, role: "", cwd: "/work" };
const REVIEWER: AgentDefinition = { ...base, id: "reviewer", name: "Reviewer", account: "claude-main", program: "claude", home: CLAUDE_HOME };
const DESIGNER: AgentDefinition = { ...base, id: "designer", name: "Designer", account: "claude-main", program: "claude", home: CLAUDE_HOME };
const WRITER: AgentDefinition = { ...base, id: "writer", name: "Writer", account: "codex-main", program: "/opt/bin/codex", home: CODEX_HOME };
const PLAIN: AgentDefinition = { ...base, id: "plain", name: "Plain", account: "gemini", program: "gemini", home: null };

describe("loginCheckArgs", () => {
  it("runs the status command of the CLI in the home of the account, and nothing for an account without a home", () => {
    expect(loginCheckArgs(REVIEWER)).toEqual(["CLAUDE_CONFIG_DIR=/c/plugin-data/agents/accounts/claude-main", "claude", "auth", "status"]);
    expect(loginCheckArgs(WRITER)).toEqual(["CODEX_HOME=/c/plugin-data/agents/accounts/codex-main", "/opt/bin/codex", "login", "status"]);
    expect(loginCheckArgs(PLAIN)).toBeNull();
  });

  it("refuses a home of a cli that is neither claude nor codex", () => {
    expect(() => loginCheckArgs({ ...PLAIN, home: CLAUDE_HOME })).toThrow("member plain: the cli gemini has no login status command");
  });

  it("gives arguments that the declared program account-login accepts", () => {
    const program = (manifest as { programs: Record<string, { program: string; args: (string | { pattern: string })[] }> }).programs["account-login"];
    expect(program.program).toBe("/usr/bin/env");
    for (const args of [loginCheckArgs(REVIEWER)!, loginCheckArgs(WRITER)!]) {
      expect(args).toHaveLength(program.args.length);
      program.args.forEach((rule, i) => {
        if (typeof rule === "string") expect(args[i]).toBe(rule);
        else expect(args[i]).toMatch(new RegExp(`^(?:${rule.pattern})$`));
      });
    }
  });
});

describe("loginOf", () => {
  it("reads 0 as a login and 1 as none, and refuses another status with the member", () => {
    expect(loginOf("reviewer", 0)).toBe(true);
    expect(loginOf("reviewer", 1)).toBe(false);
    expect(() => loginOf("reviewer", 2)).toThrow("member reviewer: the program account-login ended with status 2");
  });
});

describe("membersWithoutLogin", () => {
  it("reads each home once and gives the members of the homes without a login", async () => {
    const runs: string[][] = [];
    const run = async (args: string[]) => {
      runs.push(args);
      return { code: args[0].startsWith("CLAUDE_CONFIG_DIR=") ? 1 : 0 };
    };
    expect(await membersWithoutLogin([REVIEWER, DESIGNER, WRITER, PLAIN], run)).toEqual(new Set(["reviewer", "designer"]));
    expect(runs).toEqual([loginCheckArgs(REVIEWER), loginCheckArgs(WRITER)]);
  });

  it("fails with the member of a status that is neither 0 nor 1", async () => {
    await expect(membersWithoutLogin([WRITER], async () => ({ code: 127 }))).rejects.toThrow("member writer: the program account-login ended with status 127");
  });
});

describe("loginSession", () => {
  it("opens the login of the account in its home, titled by the account", () => {
    expect(loginSession(REVIEWER)).toEqual({ program: "env", args: ["CLAUDE_CONFIG_DIR=/c/plugin-data/agents/accounts/claude-main", "claude"], title: "claude-main 로그인" });
    expect(loginSession(WRITER)).toEqual({ program: "env", args: ["CODEX_HOME=/c/plugin-data/agents/accounts/codex-main", "/opt/bin/codex", "login"], title: "codex-main 로그인" });
  });

  it("refuses a member whose account has no home", () => {
    expect(() => loginSession(PLAIN)).toThrow("member plain needs no login");
  });
});

describe("createLoginGate", () => {
  function gateOf(codes: Record<string, number>) {
    const calls: [string, unknown][] = [];
    const gate = createLoginGate({
      run: async (args) => ({ code: codes[args[0]] }),
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
  const NO_LOGIN = { [loginCheckArgs(REVIEWER)![0]]: 1, [loginCheckArgs(WRITER)![0]]: 0 };

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
    expect(gate.sessionsChanged(new Set())).toBe(false);
    expect(gate.sessionsChanged(new Set(["s-login"]))).toBe(false);
    expect(gate.sessionsChanged(new Set())).toBe(true);
    expect(gate.sessionsChanged(new Set())).toBe(false);
  });
});
