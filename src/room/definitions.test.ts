// The agent definitions that the room reads from the stored project data of the agents plugin: the keys definitions and accounts
// (agents docs/spec/definitions.md). The room resolves program and args from the account of each definition, with the same rule as
// the agents plugin. Reads of the other plugin go through F1075 (runtime.data.get with plugin agents); the reader gets the reads.
import { describe, expect, it } from "vitest";
import manifest from "../../plugin.json";
import { readAgentDefinitions, toMemberDefinition } from "./definitions";

const DEFINITIONS = {
  writer: { name: "Writer", account: "codex-main", plugin: "terminal", role: "writer", cwd: "/work/docs" },
  reviewer: { name: "Reviewer", account: "claude-main", plugin: "terminal", role: "reviewer", cwd: "/work/project" },
};
const ACCOUNTS = [
  { id: "claude-main", cli: "claude", args: ["--verbose"], env: ["ANTHROPIC_API_KEY"] },
  { id: "codex-main", cli: "codex", args: [], env: [] },
];

// A stored value of the agents plugin per key; a missing key reads as null, as runtime.data.get answers the default of an absent key.
function storeOf(values: Record<string, unknown>) {
  const asked: string[] = [];
  return { asked, get: async (key: string) => { asked.push(key); return key in values ? values[key] : null; } };
}

// A report fails a test that expects no refused definition.
const fail = (text: string): void => { throw new Error(text); };

describe("plugin.json lists the agents plugin in dependencies", () => {
  it("declares the package of agents, whose project data the room reads", () => {
    expect(manifest.dependencies).toEqual({ "@soksak/plugin-agents": ">=0.0.1" });
  });
});

describe("readAgentDefinitions", () => {
  it("resolves each definition with the program and arguments of its account, in the code point order of its identifier", async () => {
    const store = storeOf({ definitions: DEFINITIONS, accounts: ACCOUNTS });
    expect(await readAgentDefinitions(store.get, fail)).toEqual([
      { id: "reviewer", name: "Reviewer", account: "claude-main", plugin: "terminal", program: "claude", args: ["--verbose"], role: "reviewer", cwd: "/work/project" },
      { id: "writer", name: "Writer", account: "codex-main", plugin: "terminal", program: "codex", args: [], role: "writer", cwd: "/work/docs" },
    ]);
  });

  it("reads only the two keys of the agents project data, and an absent key gives no definitions", async () => {
    const store = storeOf({});
    expect(await readAgentDefinitions(store.get, fail)).toEqual([]);
    expect(store.asked.sort()).toEqual(["accounts", "definitions"]);
  });

  it("refuses a definition whose account is not defined, naming the definition and the account", async () => {
    const store = storeOf({ definitions: { a: { ...DEFINITIONS.reviewer, account: "gone" } }, accounts: ACCOUNTS });
    await expect(readAgentDefinitions(store.get, fail)).rejects.toThrow("agents project data: definition a uses account gone that is not defined");
  });

  it("refuses definitions of another form, naming the agents project data and the key", async () => {
    await expect(readAgentDefinitions(storeOf({ definitions: [], accounts: [] }).get, fail)).rejects.toThrow(
      "agents project data definitions: the value is not an object of definition identifier to {name, account, plugin, role, cwd}",
    );
    await expect(readAgentDefinitions(storeOf({ definitions: { a: { name: "A" } }, accounts: [] }).get, fail)).rejects.toThrow(
      "agents project data definitions: definition a must have the members account, cwd, name, plugin and role, and optionally maker",
    );
  });

  // The agents plugin stores the optional member maker on a definition that a maker group listed (agents docs/spec/definitions.md).
  it("reads a definition with the optional member maker, and refuses a maker that is not a text", async () => {
    const listed = { reviewer: { ...DEFINITIONS.reviewer, maker: "moai" } };
    const read = await readAgentDefinitions(storeOf({ definitions: listed, accounts: ACCOUNTS }).get, fail);
    expect(read.map((definition) => definition.id)).toEqual(["reviewer"]);
    await expect(readAgentDefinitions(storeOf({ definitions: { a: { ...DEFINITIONS.reviewer, maker: 1 } }, accounts: ACCOUNTS }).get, fail)).rejects.toThrow(
      "agents project data definitions: definition a must have the members account, cwd, name, plugin and role, and optionally maker",
    );
  });

  it("refuses accounts of another form, naming the agents project data and the key", async () => {
    await expect(readAgentDefinitions(storeOf({ definitions: {}, accounts: {} }).get, fail)).rejects.toThrow(
      "agents project data accounts: the value is not a list of accounts",
    );
    await expect(readAgentDefinitions(storeOf({ definitions: {}, accounts: [{ id: "a", cli: "claude", args: [] }] }).get, fail)).rejects.toThrow(
      "agents project data accounts: account 0 must have the members id, cli, args and env only",
    );
  });
});

describe("toMemberDefinition", () => {
  it("gives the name and the start values of the terminal session: program, arguments, directory and role", async () => {
    const [definition] = await readAgentDefinitions(storeOf({ definitions: { reviewer: DEFINITIONS.reviewer }, accounts: ACCOUNTS }).get, fail);
    expect(toMemberDefinition(definition!)).toEqual({
      id: "reviewer",
      name: "Reviewer",
      plugin: "terminal",
      params: { program: "claude", args: ["--verbose", "--setting-sources", "project,local", "--settings", '{"env":{"CLAUDE_CODE_SHELL":"/bin/bash"}}'], directory: "/work/project", role: "reviewer" },
      cwd: "/work/project",
    });
  });

  it("starts a member with the agent of its definition when one is given (C101, docs/spec/room.md#roster)", async () => {
    const [definition] = await readAgentDefinitions(storeOf({ definitions: { reviewer: DEFINITIONS.reviewer }, accounts: ACCOUNTS }).get, fail);
    expect(toMemberDefinition(definition!, "manager-lead").params.args).toEqual([
      "--verbose", "--setting-sources", "project,local", "--settings", '{"env":{"CLAUDE_CODE_SHELL":"/bin/bash"}}', "--agent", "manager-lead",
    ]);
  });
});

// C111 (docs/spec/room.md#accept-all): the setting acceptAll starts each member with the flag of its program that accepts every request.
describe("acceptAll", () => {
  const base = { id: "w", name: "W", account: "a", plugin: "terminal", role: "", cwd: "/p" };
  it("adds --dangerously-skip-permissions to Claude Code and --yolo to Codex", () => {
    expect(toMemberDefinition({ ...base, program: "claude", args: [] }, null, true).params.args).toContain("--dangerously-skip-permissions");
    expect(toMemberDefinition({ ...base, program: "/opt/homebrew/bin/codex", args: [] }, null, true).params.args).toEqual(["--yolo"]);
  });

  it("adds no flag that the account arguments already hold, because Codex refuses a repeated --yolo", () => {
    expect(toMemberDefinition({ ...base, program: "codex", args: ["--yolo"] }, null, true).params.args).toEqual(["--yolo"]);
    expect(toMemberDefinition({ ...base, program: "codex", args: ["--dangerously-bypass-approvals-and-sandbox"] }, null, true).params.args).toEqual(["--dangerously-bypass-approvals-and-sandbox"]);
  });

  it("adds nothing while the setting is off, and refuses a program without a known flag while it is on", () => {
    expect(toMemberDefinition({ ...base, program: "codex", args: [] }).params.args).toEqual([]);
    expect(() => toMemberDefinition({ ...base, program: "aider", args: [] }, null, true)).toThrow("settings.acceptAll: program aider has no known flag that accepts every request");
  });
});

describe("reserved names (C95, docs/spec/room.md#mentions)", () => {
  it("refuses a definition named or identified all, owner or clubhouse, reports it and keeps the others", async () => {
    const definitions = {
      ...DEFINITIONS,
      all: { name: "Everyone", account: "claude-main", plugin: "terminal", role: "all", cwd: "/p" },
      "x-1": { name: "Owner", account: "claude-main", plugin: "terminal", role: "x-1", cwd: "/p" },
    };
    const reported: string[] = [];
    const read = await readAgentDefinitions(storeOf({ definitions, accounts: ACCOUNTS }).get, (text) => void reported.push(text));
    expect(read.map((definition) => definition.id)).toEqual(Object.keys(DEFINITIONS).sort());
    expect(reported).toEqual([
      "agents project data definitions: definition all uses the reserved name all",
      "agents project data definitions: definition x-1 uses the reserved name Owner",
    ]);
  });
});
