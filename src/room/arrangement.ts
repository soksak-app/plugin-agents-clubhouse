// The arrangement of the room and its member cards (C4). The room card and the member cards form one group card: the plan of
// core.layout.plan decides whether the group fits the plane of the active space. A feasible plan is applied with
// core.layout.apply; otherwise the members open as tabs of the current card, and the reason of the plan is the declared
// arrangement status (core docs/spec/cli.md#layout, plan and apply rules). Core refuses nothing here: a refused command is
// reported through the room error path and recorded in the status.

export const ROOM_PLUGIN = "soksak-plugin-agents-clubhouse";
const GROUP_NAME = "Room";

// A member is the owned session of C3. Its card shows the session through its params (core docs/spec/plugins.md#owned-sessions),
// so the card attaches to the running session and starts no process. The params also carry the name of the member as the title of its
// tab (terminal plugin docs/spec/tab-title.md), so the tab shows the name that the room shows.
export interface Member {
  plugin: string;
  session: string;
  title: string;
}

// The text rule of tab.title: 1 to 256 characters without control characters (U+0000-U+001F, U+007F-U+009F).
function isTabTitle(text: string): boolean {
  const length = [...text].length;
  return length >= 1 && length <= 256 && !/[\u0000-\u001f\u007f-\u009f]/.test(text);
}

function memberParams(member: Member): { session: string; title: string } {
  return { session: member.session, title: member.title };
}

export type ArrangementState = { state: "idle" } | { state: "group" } | { state: "tabs"; reason: string } | { state: "error"; reason: string };

export interface ArrangementStatus {
  read(): ArrangementState;
  subscribe(listener: (value: ArrangementState) => void): { dispose(): void };
  set(value: ArrangementState): void;
}

export interface ArrangementPort {
  commands: { execute(name: string, params: Record<string, unknown>): Promise<any> };
  report(where: string, text: string): void;
  // The tab that shows the session in core.sessions (`shownBy`), or null when no tab shows it.
  shownBy(session: string): string | null;
}

// The tabs of a plan that reuse an existing tab, by the session of their params.
function plannedTabs(plan: any): { tab?: unknown; params?: { session?: unknown } | null }[] {
  return (plan?.cards ?? []).flatMap((card: any) => card?.tabs ?? []);
}

// A group whose tree is a row of the room card and a column of the member cards. A single member takes the row beside the room card.
export function arrangementTree(members: Member[]): Record<string, unknown> {
  if (members.length === 0) throw new Error("arrangement needs at least one member");
  if (members.some((m) => m.session === "")) throw new Error("arrangement member needs a session");
  for (const m of members) {
    if (!isTabTitle(m.title)) {
      throw new Error(`arrangement member ${m.session}: the tab title must be a text of 1 to 256 characters without control characters`);
    }
  }
  const memberCards = members.map((m) => ({ tabs: [{ plugin: m.plugin, params: memberParams(m) }] }));
  const memberPart = memberCards.length === 1 ? memberCards[0] : { direction: "column", children: memberCards };
  return {
    group: { name: GROUP_NAME },
    tree: {
      direction: "row",
      children: [{ tabs: [{ plugin: ROOM_PLUGIN, params: null }] }, memberPart],
    },
  };
}

/**
 * Whether a session is a member session of this room that ended: a session of `sessions`, which the room opened, or of
 * `protocolSessions`, which received the room protocol and so was opened by the room, that core.sessions no longer lists
 * (docs/spec/room.md#restart). A session that received the protocol counts even when an earlier start removed it from `sessions`.
 */
export function endedRoomSession(session: string, sessions: ReadonlySet<string>, protocolSessions: ReadonlySet<string>, open: ReadonlySet<string>): boolean {
  return (sessions.has(session) || protocolSessions.has(session)) && !open.has(session);
}

/**
 * Closes each tab of the grid, the value of core.grid, whose params name a session for which ended is true: a member session that this
 * room opened and that core.sessions no longer lists (docs/spec/room.md#restart). It reads every card of the grid, so a tab that no plan
 * names is closed too, and it keeps every other tab. It resolves with the closed tabs in grid order.
 */
export async function closeEndedTabs(
  commands: ArrangementPort["commands"],
  grid: unknown,
  ended: (session: string) => boolean,
): Promise<string[]> {
  const cards = (grid as { cards?: unknown } | null)?.cards;
  if (!Array.isArray(cards)) throw new Error("core.grid has no cards list");
  const closed: string[] = [];
  for (const card of cards) {
    for (const entry of (card?.tabs ?? []) as { tab?: unknown; params?: { session?: unknown } | null }[]) {
      const session = entry.params?.session;
      if (typeof entry.tab === "string" && typeof session === "string" && ended(session)) {
        await commands.execute("core.layout.close", { tab: entry.tab });
        closed.push(entry.tab);
      }
    }
  }
  return closed;
}

export async function arrangeMembers(
  port: ArrangementPort,
  members: Member[],
  status: ArrangementStatus,
): Promise<ArrangementState> {
  const tree = arrangementTree(members);
  try {
    let plan = await port.commands.execute("core.layout.plan", { tree });
    // A tab that shows a member session but that no entry of the plan reuses holds other params, such as an earlier form of the entry;
    // core would open a new tab whose view cannot attach to the session that the old tab shows, so the room closes the old tab first
    // and plans again (docs/spec/room.md#arrangement). The session stays open.
    const reused = new Set(plannedTabs(plan).map((entry) => entry.tab).filter((tab): tab is string => typeof tab === "string"));
    let replaced = false;
    for (const member of members) {
      const showing = port.shownBy(member.session);
      // Only a plan with cards names the tabs that it reuses; a plan that is not feasible lists none and closes nothing.
      if (Array.isArray(plan?.cards) && showing !== null && !reused.has(showing)) {
        await port.commands.execute("core.layout.close", { tab: showing });
        replaced = true;
      }
    }
    if (replaced) plan = await port.commands.execute("core.layout.plan", { tree });
    if (plan.feasible === true) {
      await port.commands.execute("core.layout.apply", { tree });
      status.set({ state: "group" });
      return { state: "group" };
    }
    const reason = String(plan.reason);
    for (const member of members) {
      await port.commands.execute("core.layout.open", { card: "current", plugin: member.plugin, params: memberParams(member) });
    }
    status.set({ state: "tabs", reason });
    return { state: "tabs", reason };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    port.report("room arrangement", reason);
    status.set({ state: "error", reason });
    return { state: "error", reason };
  }
}

export function createArrangementStatus(): ArrangementStatus {
  let value: ArrangementState = { state: "idle" };
  const listeners = new Set<(value: ArrangementState) => void>();
  return {
    read: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return { dispose: () => void listeners.delete(listener) };
    },
    set(next) {
      value = next;
      for (const listener of listeners) listener(next);
    },
  };
}
