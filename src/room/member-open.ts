// The open of a member at its first turn (docs/spec/room.md#receivers): the room summons the member, which opens its session and
// arranges its tab, and answers the session once its protocol turn ended. A stop of the owner during the open ends it with TurnStopped,
// because the summon itself waits for the protocol turn and a second wait after the stop would hold the conversation (C151).
import type { ProtocolOutcome } from "./protocol";
import { TurnStopped } from "./room-relay";

export interface MemberOpenDeps {
  summon: (id: string) => Promise<void>;
  needsLogin: (id: string) => boolean;
  // The protocol turn of the open session of the member, or undefined when the member has no open session.
  protocol: (id: string) => Promise<{ session: string; result: ProtocolOutcome } | undefined>;
  // The number of stops of the owner so far.
  stops: () => number;
}

export function createMemberOpen(deps: MemberOpenDeps): (member: { id: string; name: string }) => Promise<string> {
  return async (member) => {
    const stops = deps.stops();
    await deps.summon(member.id);
    if (deps.stops() !== stops) throw new TurnStopped();
    if (deps.needsLogin(member.id)) throw new Error(`member ${member.id}: the home of its account has no login`);
    const outcome = await deps.protocol(member.id);
    if (outcome === undefined) throw new Error(`member ${member.id}: its session did not open`);
    if (!outcome.result.ok && "stopped" in outcome.result) throw new TurnStopped();
    if (!outcome.result.ok) throw new Error(outcome.result.reason);
    return outcome.session;
  };
}
