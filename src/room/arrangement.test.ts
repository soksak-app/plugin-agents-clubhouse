// The arrangement of the room and its members (C4) against the declared shapes of core.layout.plan, core.layout.apply and
// core.layout.open (core docs/spec/cli.md#layout). The port double answers with those shapes; no module is mocked.
import { describe, expect, it, vi } from "vitest";
import { ROOM_PLUGIN, arrangeMembers, arrangementTree, closeEndedTabs, endedRoomSession, createArrangementStatus, type Member } from "./arrangement";

// Each member is the owned session of C3: its card shows the session, so no member starts a process of its own.
// The plugin of each member is a fixture id that this test declares; the room receives it from its caller.
const FIXTURE_PLUGIN = "fixture-terminal";

const members: Member[] = [
  { plugin: FIXTURE_PLUGIN, session: "s-claude", title: "harness" },
  { plugin: FIXTURE_PLUGIN, session: "s-codex", title: "manager-lead" },
];

function port(plan: unknown, options: { applyRejects?: boolean; planRejects?: boolean; shownBy?: Record<string, string> } = {}) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const reports: Array<[string, string]> = [];
  const execute = vi.fn(async (name: string, params: Record<string, unknown>) => {
    calls.push([name, params]);
    if (name === "core.layout.plan") {
      if (options.planRejects) throw new Error("layout plan refused");
      return plan;
    }
    if (name === "core.layout.apply") {
      if (options.applyRejects) throw new Error("layout apply refused");
      return { tree: params.tree, cards: [], kept: [], closed: [] };
    }
    return { card: "new", tab: "new" };
  });
  return {
    calls,
    reports,
    port: {
      commands: { execute },
      report: (where: string, text: string) => reports.push([where, text]),
      shownBy: (session: string) => options.shownBy?.[session] ?? null,
    },
  };
}

const feasible = { feasible: true, tree: { direction: "row", children: [] }, cards: [], reason: null };
const infeasible = {
  feasible: false,
  reason: "card 2 of the tree would be 300 × 90 points, below the minimum 320 × 240 points; the tree needs a plane of 1200 × 900 points and the plane is 800 × 600 points",
  needed: { width: 1200, height: 900 },
  proposal: null,
};

describe("arrangementTree", () => {
  it("puts the room card beside a column of the member cards inside one named group", () => {
    expect(arrangementTree(members)).toEqual({
      group: { name: "Room" },
      tree: {
        direction: "row",
        children: [
          { tabs: [{ plugin: ROOM_PLUGIN, params: null }] },
          {
            direction: "column",
            children: [
              { tabs: [{ plugin: FIXTURE_PLUGIN, params: { session: "s-claude", title: "harness" } }] },
              { tabs: [{ plugin: FIXTURE_PLUGIN, params: { session: "s-codex", title: "manager-lead" } }] },
            ],
          },
        ],
      },
    });
  });

  it("uses one member card directly when there is a single member", () => {
    const tree = arrangementTree([members[0]]) as { tree: { children: unknown[] } };
    expect(tree.tree.children[1]).toEqual({ tabs: [{ plugin: FIXTURE_PLUGIN, params: { session: "s-claude", title: "harness" } }] });
  });

  it("refuses an empty member list at the boundary", () => {
    expect(() => arrangementTree([])).toThrow("arrangement needs at least one member");
  });

  it("refuses a member without a session, because its card would start a second process", () => {
    expect(() => arrangementTree([{ plugin: FIXTURE_PLUGIN, session: "", title: "harness" }])).toThrow("arrangement member needs a session");
  });

  // The title of a member tab follows the text rule of tab.title (terminal plugin docs/spec/tab-title.md): 1 to 256 characters
  // without control characters. The room refuses another name before it sends a layout command.
  it.each([
    ["an empty name", ""],
    ["a name of 257 characters", "a".repeat(257)],
    ["a name with a line feed", "harness\nlead"],
    ["a name with a C1 control character", "harness\u0085"],
  ])("refuses %s as the title of a member tab", (_label, title) => {
    expect(() => arrangementTree([{ plugin: FIXTURE_PLUGIN, session: "s-claude", title }])).toThrow(
      "arrangement member s-claude: the tab title must be a text of 1 to 256 characters without control characters",
    );
  });

  it("accepts a name of 256 characters counted as code points", () => {
    const title = "가".repeat(255) + "\u{1F600}";
    expect(arrangementTree([{ plugin: FIXTURE_PLUGIN, session: "s-claude", title }]).tree).toMatchObject({
      children: [{}, { tabs: [{ params: { session: "s-claude", title } }] }],
    });
  });
});

describe("arrangeMembers replaces a showing tab of other params (docs/spec/room.md#arrangement)", () => {
  // The old member tab tab-old shows s-claude with the params {session} of an earlier entry form, so the plan reuses no tab for it.
  const planWith = (tabs: { tab: string | null; params: unknown }[]) => ({ ...feasible, cards: [{ card: null, tabs, active: null, group: null }] });

  it("closes the tab that shows a member session with an earlier entry form before the apply, and plans again", async () => {
    const plan = planWith([{ tab: null, params: { session: "s-claude", title: "harness" } }, { tab: "tab-codex", params: { session: "s-codex", title: "manager-lead" } }]);
    const { port: p, calls } = port(plan, { shownBy: { "s-claude": "tab-old", "s-codex": "tab-codex" } });
    const result = await arrangeMembers(p, members, createArrangementStatus());
    expect(result).toEqual({ state: "group" });
    expect(calls.map(([name, params]) => (name === "core.layout.close" ? `${name} ${params.tab}` : name))).toEqual([
      "core.layout.plan",
      "core.layout.close tab-old",
      "core.layout.plan",
      "core.layout.apply",
    ]);
  });

  it("closes no tab that the plan reuses for an entry", async () => {
    const plan = planWith([{ tab: "tab-claude", params: { session: "s-claude", title: "harness" } }]);
    const { port: p, calls } = port(plan, { shownBy: { "s-claude": "tab-claude" } });
    await arrangeMembers(p, members, createArrangementStatus());
    expect(calls.map(([name]) => name)).toEqual(["core.layout.plan", "core.layout.apply"]);
  });

  it("closes no tab for a plan that is not feasible, which names no tabs", async () => {
    const { port: p, calls } = port(infeasible, { shownBy: { "s-claude": "tab-old" } });
    await arrangeMembers(p, members, createArrangementStatus());
    expect(calls.some(([name]) => name === "core.layout.close")).toBe(false);
  });
});

describe("arrangeMembers", () => {
  it("plans the tree and applies the planned tree when the plan is feasible", async () => {
    const { port: p, calls } = port(feasible);
    const status = createArrangementStatus();
    const result = await arrangeMembers(p, members, status);
    expect(result).toEqual({ state: "group" });
    expect(calls.map(([name]) => name)).toEqual(["core.layout.plan", "core.layout.apply"]);
    expect(calls[1][1]).toEqual({ tree: arrangementTree(members) });
    expect(status.read()).toEqual({ state: "group" });
  });

  it("opens the members as tabs of their sessions with the reason of the plan when the plan is not feasible", async () => {
    const { port: p, calls } = port(infeasible);
    const status = createArrangementStatus();
    const result = await arrangeMembers(p, members, status);
    expect(result).toEqual({ state: "tabs", reason: infeasible.reason });
    expect(calls.map(([name]) => name)).toEqual([
      "core.layout.plan",
      "core.layout.open",
      "core.layout.open",
    ]);
    expect(calls[1][1]).toEqual({ card: "current", plugin: FIXTURE_PLUGIN, params: { session: "s-claude", title: "harness" } });
    expect(calls[2][1]).toEqual({ card: "current", plugin: FIXTURE_PLUGIN, params: { session: "s-codex", title: "manager-lead" } });
    expect(status.read()).toEqual({ state: "tabs", reason: infeasible.reason });
  });

  it("reports and records a refused plan, and opens nothing", async () => {
    const { port: p, calls, reports } = port(infeasible, { planRejects: true });
    const status = createArrangementStatus();
    await arrangeMembers(p, members, status);
    expect(calls.map(([name]) => name)).toEqual(["core.layout.plan"]);
    expect(reports).toEqual([["room arrangement", "layout plan refused"]]);
    expect(status.read()).toEqual({ state: "error", reason: "layout plan refused" });
  });

  it("reports and records a refused apply of a feasible plan", async () => {
    const { port: p, reports } = port(feasible, { applyRejects: true });
    const status = createArrangementStatus();
    await arrangeMembers(p, members, status);
    expect(reports).toEqual([["room arrangement", "layout apply refused"]]);
    expect(status.read()).toEqual({ state: "error", reason: "layout apply refused" });
  });

  it("notifies the status subscribers on each change", async () => {
    const { port: p } = port(feasible);
    const status = createArrangementStatus();
    const seen: unknown[] = [];
    status.subscribe((value) => seen.push(value));
    await arrangeMembers(p, members, status);
    expect(seen).toEqual([{ state: "group" }]);
  });
});

// The arrangement closes no tab that the room did not open (C38, docs/spec/room.md#arrangement): it passes no `close`, so core
// keeps the other tabs of the plane at the end of the first card of the tree, the room card, whose active entry is the room tab.
describe("the other tabs of the plane", () => {
  it("plans and applies without close, with the room tab as the active entry of the first card", async () => {
    const p = port(feasible);
    await arrangeMembers(p.port, members, createArrangementStatus());
    const sent = p.calls.filter(([name]) => name === "core.layout.plan" || name === "core.layout.apply");
    expect(sent.map(([name]) => name)).toEqual(["core.layout.plan", "core.layout.apply"]);
    for (const [, params] of sent) {
      expect(Object.keys(params)).toEqual(["tree"]);
      const first = (params.tree as any).tree.children[0];
      expect(first.tabs[first.active ?? 0]).toEqual({ plugin: ROOM_PLUGIN, params: null });
    }
  });
});

describe("closeEndedTabs after a restart (docs/spec/room.md#restart, C145)", () => {
  it("closes every tab of the grid whose session the room opened and that ended, also a tab that no plan names, and keeps the others", async () => {
    const grid = {
      cards: [
        { id: "card-1", tabs: [
          { tab: "tab-room", plugin: ROOM_PLUGIN, params: null },
          { tab: "tab-dead", plugin: FIXTURE_PLUGIN, params: { session: "owned-old", title: "manager-lead" } },
          { tab: "tab-person", plugin: FIXTURE_PLUGIN, params: { session: "owned-person" } },
          { tab: "tab-shell", plugin: FIXTURE_PLUGIN, params: null },
        ] },
        { id: "card-3", tabs: [{ tab: "tab-other-dead", plugin: FIXTURE_PLUGIN, params: { session: "owned-gone" } }] },
      ],
    };
    const double = port({ feasible: true, cards: [] });
    const ended = (session: string) => session === "owned-old" || session === "owned-gone";
    expect(await closeEndedTabs(double.port.commands, grid, ended)).toEqual(["tab-dead", "tab-other-dead"]);
    expect(double.calls).toEqual([["core.layout.close", { tab: "tab-dead" }], ["core.layout.close", { tab: "tab-other-dead" }]]);
  });

  it("refuses a grid without its cards list", async () => {
    const double = port({ feasible: true, cards: [] });
    await expect(closeEndedTabs(double.port.commands, { size: 1 }, () => true)).rejects.toThrow("core.grid has no cards list");
  });
});

describe("endedRoomSession (docs/spec/room.md#restart, C146)", () => {
  const open = new Set(["owned-open"]);
  it("counts a session of sessions or of protocolSessions that core.sessions no longer lists as an ended session of the room", () => {
    expect(endedRoomSession("owned-gone", new Set(["owned-gone"]), new Set(), open)).toBe(true);
    expect(endedRoomSession("owned-taught", new Set(), new Set(["owned-taught"]), open)).toBe(true);
  });

  it("keeps an open session and a session that the room never opened", () => {
    expect(endedRoomSession("owned-open", new Set(["owned-open"]), new Set(["owned-open"]), open)).toBe(false);
    expect(endedRoomSession("owned-person", new Set(), new Set(), open)).toBe(false);
  });
});
