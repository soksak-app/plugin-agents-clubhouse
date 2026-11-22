// The message relay of the room (C5, docs/spec/room.md) over the members' owned sessions. The mode and the mentions of a message decide
// which members receive it and whether their turns run one after another or at the same time. The answer of a member is the screen
// that core.session.read reports after its turn, which the room shows as text.
import { relayMemberMessage, type SessionRelayPort } from "./relay";
import { sessionProgram, sessionRead, sessionSubmit, type SessionCommandPort } from "./session-channel";
import { mentionedMembers } from "./mention";
import type { RoomMode } from "./commands";

export interface RelayMember {
  id: string;
  // The owned session of the member (the summon relation of C3).
  session: string;
}

export interface NamedRelayMember extends RelayMember {
  // The name of the member in the roster, which a mention may use.
  name: string;
}

export interface MemberAnswer {
  id: string;
  rows: string[];
}

export interface RelayPorts extends SessionCommandPort {
  // The current value of core.sessions, the list of open sessions.
  sessions(): unknown;
  // Calls the listener with each new value of core.sessions; the returned function ends the watch.
  watchSessions(listener: (value: unknown) => void): () => void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Sends the text to one member and resolves with its screen after its turn. A refusal, a turn that is blocked, or a session that
// leaves core.sessions rejects with the member identifier and the reason.
async function relayToMember(ports: RelayPorts, member: RelayMember, text: string): Promise<MemberAnswer> {
  const controller = new AbortController();
  // A value of core.sessions that the relay cannot read ends the turn with this error, so the relay never waits on a bad value.
  let failure: unknown = null;
  const port: SessionRelayPort = {
    submit: sessionSubmit(ports, member.session),
    program: () => sessionProgram(ports.sessions(), member.session),
    watch: (listener) => ports.watchSessions((value) => {
      try {
        listener(sessionProgram(value, member.session));
      } catch (error) {
        failure = error;
        controller.abort();
      }
    }),
  };
  try {
    await relayMemberMessage(port, text, { signal: controller.signal });
  } catch (error) {
    throw new Error(`member ${member.id}: ${messageOf(failure ?? error)}`);
  }
  const screen = await sessionRead(ports, member.session);
  return { id: member.id, rows: screen.rows };
}

// Sends the text to each member in order and resolves with the screen of each member. A failed turn rejects with the member and the
// reason, and the members after it receive nothing.
export async function relayToMembers(ports: RelayPorts, members: RelayMember[], text: string): Promise<MemberAnswer[]> {
  const answers: MemberAnswer[] = [];
  for (const member of members) answers.push(await relayToMember(ports, member, text));
  return answers;
}

// Relays a room message by the mode of the room (docs/spec/room.md#modes). A message that mentions members goes only to them in
// mention order: one after another in turn and facil, at the same time in simul. Without a mention, turn relays to each member in
// roster order, facil to the first member whose session is idle, and simul to every member at the same time.
export async function relayInMode(ports: RelayPorts, mode: RoomMode, members: NamedRelayMember[], message: string): Promise<MemberAnswer[]> {
  const mentioned = mentionedMembers(message, members);
  // The person speaks as the owner (docs/spec/room.md#speaker-labels).
  const text = `[@owner] ${message}`;
  if (mode === "simul") {
    const targets = mentioned.length > 0 ? mentioned : members;
    const results = await Promise.allSettled(targets.map((member) => relayToMember(ports, member, text)));
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
    return results.map((result) => (result as PromiseFulfilledResult<MemberAnswer>).value);
  }
  if (mentioned.length > 0) return relayToMembers(ports, mentioned, text);
  if (mode === "turn") return relayToMembers(ports, members, text);
  const sessions = ports.sessions();
  const idle = members.find((member) => sessionProgram(sessions, member.session) === "idle");
  if (!idle) throw new Error("no member is idle");
  return [await relayToMember(ports, idle, text)];
}
