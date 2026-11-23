// The start of the room page as the host starts it (C96): the built page module loads into a view of the test host of the plugin API,
// and the core.sessions value arrives at the first watch. No listener of the page may read a value that the page has not defined yet.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openView, turn } from "@soksak/plugin-api/testing";

const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));
const html = readFileSync(new URL("../ui/clubhouse.html", import.meta.url), "utf8");
const settings = Object.fromEntries(Object.entries(manifest.settings as Record<string, { default: unknown }>).map(([key, entry]) => [key, entry.default]));

describe("the start of the room page (C96)", () => {
  it("starts with a sessions value at the first watch without an error and fills the roster from the definitions", async () => {
    execFileSync("node", ["build.mjs"], { cwd: new URL("..", import.meta.url), stdio: "ignore" });
    const view = await openView("soksak-plugin-agents-clubhouse", {
      start: { surface: "tab-1", params: null, project: { id: "p-1", root: "/work" } },
      declarations: manifest.exposes,
      html,
      page: "ui/clubhouse.html",
      host: {
        surface: "tab-1",
        declarations: manifest.exposes,
        settings,
        data: manifest.data,
        project: { id: "p-1", root: "/work" },
        statuses: { "core.sessions": [], "core.roles": [] },
        state: { read: () => null, write: () => {} },
        dependencies: {
          "@soksak/plugin-agents": {
            plugin: "agents",
            data: { definitions: { schema: { type: "object" }, default: {} }, accounts: { schema: { type: "array" }, default: [] } },
            values: {
              definitions: { harness: { name: "harness", account: "claude-main", plugin: "terminal", role: "harness", cwd: "/work" } },
              accounts: [{ id: "claude-main", cli: "claude", args: [], env: [] }],
            },
          },
        },
        commands: {},
      },
    });
    // jsdom has no IntersectionObserver and lays nothing out, so no element intersects: the observer takes its targets and notifies none.
    // The page reads the bare name, which the window of the view does not bind because jsdom does not define it.
    const observer = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
    Object.assign(globalThis, { IntersectionObserver: observer });
    await view.load(new URL("../ui/clubhouse.js", import.meta.url));
    for (let step = 0; step < 20; step += 1) await turn();
    await view.settled();
    expect({ errors: view.observed.errors, failures: view.observed.failures, tab: view.observed.tab.error }).toEqual({ errors: [], failures: [], tab: null });
    expect(view.window.document.body.textContent).toContain("harness");
    // C119 (docs/spec/room.md#header): a room without a checked member reports the plugin name as its tab title.
    expect(view.observed.tab.title).toBe(manifest.name);
    // C115 (docs/spec/room.md#roster): a definition that the agents plugin adds later reaches the room through the data changes of
    // the agents plugin, which runtime.data.on follows only with {plugin}.
    view.change!.dependencyData("agents", "definitions", {
      harness: { name: "harness", account: "claude-main", plugin: "terminal", role: "harness", cwd: "/work" },
      reviewer: { name: "reviewer", account: "claude-main", plugin: "terminal", role: "reviewer", cwd: "/work" },
    });
    for (let step = 0; step < 20; step += 1) await turn();
    await view.settled();
    expect(view.window.document.body.textContent).toContain("reviewer");
    await view.close();
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  });
});
