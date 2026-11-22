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

export async function arrangeMembers(
  port: ArrangementPort,
  members: Member[],
  status: ArrangementStatus,
  // Whether a session is a member session that this room opened and that has ended (docs/spec/room.md#restart).
  ended: (session: string) => boolean = () => false,
): Promise<ArrangementState> {
  const tree = arrangementTree(members);
  try {
    const plan = await port.commands.execute("core.layout.plan", { tree });
    if (plan.feasible === true) {
      await port.commands.execute("core.layout.apply", { tree });
      // The apply reuses each tab whose plugin and params an entry of the tree names; a tab of an ended member session of this room
      // names no entry and stays as an inactive tab, so the room closes it. Tabs of the person are kept.
      const planned: { tab?: unknown; params?: { session?: unknown } | null }[] = (plan.cards ?? []).flatMap((card: any) => card?.tabs ?? []);
      for (const entry of planned) {
        const session = entry.params?.session;
        if (typeof entry.tab === "string" && typeof session === "string" && ended(session)) {
          await port.commands.execute("core.layout.close", { tab: entry.tab });
        }
      }
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
