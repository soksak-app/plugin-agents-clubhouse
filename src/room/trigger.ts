// The summon trigger of the room (C3-1) and the arrangement after it (C4). A change of the roster summons the checked members with
// summonMembers, then arranges the members that opened with arrangeMembers. The plugin of each member is the plugin of its definition.
import { arrangeMembers, type ArrangementPort, type ArrangementState, type ArrangementStatus, type Member } from "./arrangement";
import { summonMembers, type MemberDefinition, type SessionSize, type SummonDeps } from "./summon";

export interface TriggerDeps {
  summon: SummonDeps;
  arrange: ArrangementPort;
  status: ArrangementStatus;
  // The size of the sessions that open now: the card size of the window (core docs/spec/plugins.md#owned-sessions).
  size: () => SessionSize;
  // Whether a session is a member session that this room opened and that has ended.
  ended: (session: string) => boolean;
}

// Summons the checked members and arranges the opened ones. A refused summon rejects with its text and arranges nothing.
export async function summonAndArrange(
  deps: TriggerDeps,
  definitions: MemberDefinition[],
  checked: string[],
): Promise<ArrangementState> {
  const summoned = await summonMembers(deps.summon, { definitions, checked, size: deps.size() });
  const members: Member[] = summoned.map((member) => {
    const definition = definitions.find((entry) => entry.id === member.id);
    if (definition === undefined) throw new Error(`summoned member ${member.id} has no definition`);
    return { plugin: definition.plugin, session: member.session };
  });
  if (members.length === 0) {
    deps.status.set({ state: "idle" });
    return { state: "idle" };
  }
  return arrangeMembers(deps.arrange, members, deps.status, deps.ended);
}

// Runs each task after the previous one has settled, so two checks of the roster never interleave their summons and arrangements.
// A failed task does not stop the next one.
export function serialRunner(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };
}
