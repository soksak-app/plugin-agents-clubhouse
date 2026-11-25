// The open of a member at its first turn (docs/spec/room.md#receivers): the room summons the member, which opens its session and
// arranges its tab, and answers the session once its protocol turn ended. A stop of the owner during the open ends it with TurnStopped,
// because the summon itself waits for the protocol turn and a second wait after the stop would hold the conversation (C151).
import type { ProtocolOutcome } from "./protocol";
import { TurnStopped } from "./room-relay";

export interface MemberOpenDeps {
  // The check of the member before its session opens, which rejects with its reasons (docs/spec/room.md#check).
  check: (id: string) => Promise<void>;
  summon: (id: string) => Promise<void>;
  // The account of the member while the home of that account has no login, or null (docs/spec/room.md#login).
  loginless: (id: string) => string | null;
  // The protocol turn of the open session of the member, or undefined when the member has no open session.
  protocol: (id: string) => Promise<{ session: string; result: ProtocolOutcome } | undefined>;
  // The number of stops of the owner so far.
  stops: () => number;
}

export function createMemberOpen(deps: MemberOpenDeps): (member: { id: string; name: string }) => Promise<string> {
  return async (member) => {
    await deps.check(member.id);
    const stops = deps.stops();
    await deps.summon(member.id);
    if (deps.stops() !== stops) throw new TurnStopped();
    const account = deps.loginless(member.id);
    // The refusal names the account and the place of its login, because the room opens no login (docs/spec/room.md#login).
    if (account !== null) throw new Error(`member ${member.id}: the account ${account} has no login; log in to it in the settings of the agents plugin and send again`);
    const outcome = await deps.protocol(member.id);
    if (outcome === undefined) throw new Error(`member ${member.id}: its session did not open`);
    if (!outcome.result.ok && "stopped" in outcome.result) throw new TurnStopped();
    if (!outcome.result.ok) throw new Error(outcome.result.reason);
    return outcome.session;
  };
}

// The members of a relay with the session of each whose protocol turn ended (C153, docs/spec/room.md#receivers): a member with an open
// session that has not received the protocol gets null, so the relay opens it at its own turn and a message waits for no protocol turn
// of a member that takes no turn.
export function relayGroup(
  members: readonly { id: string; name: string }[],
  open: readonly { id: string; name: string; session: string }[],
  taught: ReadonlySet<string>,
): { id: string; name: string; session: string | null }[] {
  return members.map((entry) => {
    const session = open.find((one) => one.id === entry.id)?.session;
    return { id: entry.id, name: entry.name, session: session !== undefined && taught.has(session) ? session : null };
  });
}
