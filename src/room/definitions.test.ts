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

describe("plugin.json lists the agents plugin in dependencies", () => {
  it("declares the package of agents, whose project data the room reads", () => {
    expect(manifest.dependencies).toEqual({ "@soksak/plugin-agents": ">=0.0.1" });
  });
});

describe("readAgentDefinitions", () => {
  it("resolves each definition with the program and arguments of its account, in the code point order of its identifier", async () => {
    const store = storeOf({ definitions: DEFINITIONS, accounts: ACCOUNTS });
    expect(await readAgentDefinitions(store.get)).toEqual([
      { id: "reviewer", name: "Reviewer", account: "claude-main", plugin: "terminal", program: "claude", args: ["--verbose"], role: "reviewer", cwd: "/work/project" },
      { id: "writer", name: "Writer", account: "codex-main", plugin: "terminal", program: "codex", args: [], role: "writer", cwd: "/work/docs" },
    ]);
  });

  it("reads only the two keys of the agents project data, and an absent key gives no definitions", async () => {
    const store = storeOf({});
    expect(await readAgentDefinitions(store.get)).toEqual([]);
    expect(store.asked.sort()).toEqual(["accounts", "definitions"]);
  });

  it("refuses a definition whose account is not defined, naming the definition and the account", async () => {
    const store = storeOf({ definitions: { a: { ...DEFINITIONS.reviewer, account: "gone" } }, accounts: ACCOUNTS });
    await expect(readAgentDefinitions(store.get)).rejects.toThrow("agents project data: definition a uses account gone that is not defined");
  });

  it("refuses definitions of another form, naming the agents project data and the key", async () => {
    await expect(readAgentDefinitions(storeOf({ definitions: [], accounts: [] }).get)).rejects.toThrow(
      "agents project data definitions: the value is not an object of definition identifier to {name, account, plugin, role, cwd}",
    );
    await expect(readAgentDefinitions(storeOf({ definitions: { a: { name: "A" } }, accounts: [] }).get)).rejects.toThrow(
      "agents project data definitions: definition a must have the members account, cwd, name, plugin and role",
    );
  });

  it("refuses accounts of another form, naming the agents project data and the key", async () => {
    await expect(readAgentDefinitions(storeOf({ definitions: {}, accounts: {} }).get)).rejects.toThrow(
      "agents project data accounts: the value is not a list of accounts",
    );
    await expect(readAgentDefinitions(storeOf({ definitions: {}, accounts: [{ id: "a", cli: "claude", args: [] }] }).get)).rejects.toThrow(
      "agents project data accounts: account 0 must have the members id, cli, args and env only",
    );
  });
});

describe("toMemberDefinition", () => {
  it("gives the start values of the terminal session: program, arguments, directory and role", async () => {
    const [definition] = await readAgentDefinitions(storeOf({ definitions: { reviewer: DEFINITIONS.reviewer }, accounts: ACCOUNTS }).get);
    expect(toMemberDefinition(definition!)).toEqual({
      id: "reviewer",
      plugin: "terminal",
      params: { program: "claude", args: ["--verbose"], directory: "/work/project", role: "reviewer" },
      cwd: "/work/project",
    });
  });
});
