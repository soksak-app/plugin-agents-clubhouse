// The arrangement of the room and its member cards (C4). The room card and the member cards form one group card: the plan of
// core.layout.plan decides whether the group fits the plane of the active space. A feasible plan is applied with
// core.layout.apply; otherwise the members open as tabs of the current card, and the reason of the plan is the declared
// arrangement status (core docs/spec/cli.md#layout, plan and apply rules). Core refuses nothing here: a refused command is
// reported through the room error path and recorded in the status.

export const ROOM_PLUGIN = "soksak-plugin-agents-clubhouse";
const GROUP_NAME = "Room";

export interface Member {
  plugin: string;
  params: Record<string, unknown>;
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
  const memberCards = members.map((m) => ({ tabs: [{ plugin: m.plugin, params: m.params }] }));
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
): Promise<ArrangementState> {
  const tree = arrangementTree(members);
  try {
    const plan = await port.commands.execute("core.layout.plan", { tree });
    if (plan.feasible === true) {
      await port.commands.execute("core.layout.apply", { tree });
      status.set({ state: "group" });
      return { state: "group" };
    }
    const reason = String(plan.reason);
    for (const member of members) {
      await port.commands.execute("core.layout.open", { card: "current", plugin: member.plugin, params: member.params });
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
