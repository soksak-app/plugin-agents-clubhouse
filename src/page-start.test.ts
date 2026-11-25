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
  it("starts with a sessions value at the first watch without an error and shows the members of the assigned group (C140)", async () => {
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
            data: {
              definitions: { schema: { type: "object" }, default: {} },
              accounts: { schema: { type: "array" }, default: [] },
              groups: { schema: { type: "object" }, default: {} },
            },
            values: {
              definitions: {
                harness: { name: "harness", account: "claude-main", plugin: "terminal", role: "harness", cwd: "/work" },
                reviewer: { name: "reviewer", account: "claude-main", plugin: "terminal", role: "reviewer", cwd: "/work" },
              },
              accounts: [{ id: "claude-main", cli: "claude", args: [], env: [], home: null }],
              groups: { g1: { name: "Team", members: ["harness"], leader: "harness" } },
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
    // C140 (docs/spec/room.md#group): a room tab without a state has no group, so it has no members and no card, and the group select
    // lists the groups of the agents plugin after its placeholder.
    type State = { group: string | null; members: { id: string; leader: boolean }[]; transport: { state: string } };
    const state = (await view.request("soksak-plugin-agents-clubhouse.state", {})) as State;
    expect({ group: state.group, members: state.members, transport: state.transport.state }).toEqual({ group: null, members: [], transport: "unavailable" });
    const document = view.window.document;
    expect(document.querySelectorAll(".st-tab").length).toBe(0);
    const select = document.querySelector(".st-group") as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual(["그룹 선택", "Team"]);
    // C119 (docs/spec/room.md#header): a room without a member reports the plugin name as its tab title.
    expect(view.observed.tab.title).toBe(manifest.name);
    // group.set assigns the group: its leader shows the star before its name.
    expect(await view.request("soksak-plugin-agents-clubhouse.group.set", { group: "g1" })).toEqual({ group: "g1" });
    const assigned = (await view.request("soksak-plugin-agents-clubhouse.state", {})) as State;
    expect({ group: assigned.group, members: assigned.members }).toEqual({ group: "g1", members: [{ id: "harness", leader: true }] });
    // C142 (docs/spec/room.md#header): the composer takes input while the group has a member, before any member session is open.
    expect(assigned.transport.state).toBe("ready");
    expect((view.window.document.querySelector("textarea") as HTMLTextAreaElement).disabled).toBe(false);
    expect([...document.querySelectorAll(".st-tab .nm")].map((name) => name.textContent)).toEqual(["\u2B50 harness"]);
    expect(select.value).toBe("g1");
    // C148 (docs/spec/room.md#worktrees): a member without a session shows no button 끝내기.
    expect([...document.querySelectorAll(".st-tab .end")].map((button) => (button as HTMLButtonElement).hidden)).toEqual([true]);
    // C115 (docs/spec/room.md#group): a member that the agents plugin adds to the group reaches the room through the data changes of
    // the agents plugin, which runtime.data.on follows only with {plugin}.
    view.change!.dependencyData("agents", "groups", { g1: { name: "Team", members: ["harness", "reviewer"], leader: "harness" } });
    for (let step = 0; step < 20; step += 1) await turn();
    await view.settled();
    const later = (await view.request("soksak-plugin-agents-clubhouse.state", {})) as State;
    expect(later.members).toEqual([{ id: "harness", leader: true }, { id: "reviewer", leader: false }]);
    expect({ errors: view.observed.errors, failures: view.observed.failures, tab: view.observed.tab.error }).toEqual({ errors: [], failures: [], tab: null });
    await view.close();
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  });
});
