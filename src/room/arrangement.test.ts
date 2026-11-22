// The arrangement of the room and its members (C4) against the declared shapes of core.layout.plan, core.layout.apply and
// core.layout.open (core docs/spec/cli.md#layout). The port double answers with those shapes; no module is mocked.
import { describe, expect, it, vi } from "vitest";
import { ROOM_PLUGIN, arrangeMembers, arrangementTree, createArrangementStatus, type Member } from "./arrangement";

// Each member is the owned session of C3: its card shows the session, so no member starts a process of its own.
// The plugin of each member is a fixture id that this test declares; the room receives it from its caller.
const FIXTURE_PLUGIN = "fixture-terminal";

const members: Member[] = [
  { plugin: FIXTURE_PLUGIN, session: "s-claude" },
  { plugin: FIXTURE_PLUGIN, session: "s-codex" },
];

function port(plan: unknown, options: { applyRejects?: boolean; planRejects?: boolean } = {}) {
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
    port: { commands: { execute }, report: (where: string, text: string) => reports.push([where, text]) },
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
              { tabs: [{ plugin: FIXTURE_PLUGIN, params: { session: "s-claude" } }] },
              { tabs: [{ plugin: FIXTURE_PLUGIN, params: { session: "s-codex" } }] },
            ],
          },
        ],
      },
    });
  });

  it("uses one member card directly when there is a single member", () => {
    const tree = arrangementTree([members[0]]) as { tree: { children: unknown[] } };
    expect(tree.tree.children[1]).toEqual({ tabs: [{ plugin: FIXTURE_PLUGIN, params: { session: "s-claude" } }] });
  });

  it("refuses an empty member list at the boundary", () => {
    expect(() => arrangementTree([])).toThrow("arrangement needs at least one member");
  });

  it("refuses a member without a session, because its card would start a second process", () => {
    expect(() => arrangementTree([{ plugin: FIXTURE_PLUGIN, session: "" }])).toThrow("arrangement member needs a session");
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
    expect(calls[1][1]).toEqual({ card: "current", plugin: FIXTURE_PLUGIN, params: { session: "s-claude" } });
    expect(calls[2][1]).toEqual({ card: "current", plugin: FIXTURE_PLUGIN, params: { session: "s-codex" } });
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

describe("arrangeMembers after a restart (docs/spec/room.md#restart)", () => {
  it("reuses the member tabs through the tree and closes the tabs of the room's ended member sessions", async () => {
    const plan = {
      feasible: true,
      reason: null,
      cards: [
        {
          card: "card-1",
          tabs: [
            { tab: "tab-room", plugin: ROOM_PLUGIN, params: null },
            { tab: "tab-dead", plugin: FIXTURE_PLUGIN, params: { session: "owned-old" } },
            { tab: "tab-person", plugin: FIXTURE_PLUGIN, params: { session: "owned-person" } },
            { tab: "tab-shell", plugin: FIXTURE_PLUGIN, params: null },
          ],
        },
        { card: "card-2", tabs: [{ tab: "tab-claude", plugin: FIXTURE_PLUGIN, params: { session: "s-claude" } }] },
      ],
    };
    const double = port(plan);
    const ended = (session: string) => session === "owned-old";
    expect(await arrangeMembers(double.port, members, createArrangementStatus(), ended)).toEqual({ state: "group" });
    expect(double.calls.map(([name]) => name)).toEqual(["core.layout.plan", "core.layout.apply", "core.layout.close"]);
    expect(double.calls[2]).toEqual(["core.layout.close", { tab: "tab-dead" }]);
    expect(double.reports).toEqual([]);
  });
});
