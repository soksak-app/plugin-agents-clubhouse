// The message relay of the room (C5, docs/spec/room.md) over the members' owned sessions. The mode and the mentions of a message decide
// which members receive it and whether their turns run one after another or at the same time. The answer of a member is the reply block
// of the screen that core.session.read reports after its turn (docs/spec/room.md#answer). In a relay one after another, each member
// receives the answers of the members before it with the message, so that it reads what was said before its turn.
import { relayMemberMessage, type SessionRelayPort } from "./relay";
import { sessionProgram, sessionRead, sessionSubmit, type SessionCommandPort } from "./session-channel";
import { mentionedMembers } from "./mention";
import { answerText } from "./answer";
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
  text: string;
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

// Sends the text to one member and resolves with its answer after its turn. A refusal, a turn that is blocked, a session that leaves
// core.sessions, or a screen whose reply rows break the rule of the answer rejects with the member identifier and the reason.
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
  try {
    const screen = await sessionRead(ports, member.session);
    return { id: member.id, text: answerText(screen.rows) };
  } catch (error) {
    throw new Error(`member ${member.id}: ${messageOf(error)}`);
  }
}

// Sends the text to each member in order and resolves with the answer of each member. A failed turn rejects with the member and the
// reason, and the members after it receive nothing.
export async function relayToMembers(ports: RelayPorts, members: RelayMember[], text: string): Promise<MemberAnswer[]> {
  const answers: MemberAnswer[] = [];
  for (const member of members) answers.push(await relayToMember(ports, member, text));
  return answers;
}

const oneLine = (text: string): string => text.replace(/\r\n|\r|\n/g, " ");

// Relays the labeled message to each member in order; each member receives the message followed by the answers before its turn, each
// as `[@<name>] <answer>`, joined with " | " because core.session.submit refuses CR and LF (docs/spec/room.md#modes).
async function relayInTurn(ports: RelayPorts, members: NamedRelayMember[], text: string): Promise<MemberAnswer[]> {
  const answers: MemberAnswer[] = [];
  const lines = [text];
  for (const member of members) {
    const answer = await relayToMember(ports, member, lines.join(" | "));
    answers.push(answer);
    lines.push(`[@${member.name}] ${oneLine(answer.text)}`);
  }
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
  if (mentioned.length > 0) return relayInTurn(ports, mentioned, text);
  if (mode === "turn") return relayInTurn(ports, members, text);
  const sessions = ports.sessions();
  const idle = members.find((member) => sessionProgram(sessions, member.session) === "idle");
  if (!idle) throw new Error("no member is idle");
  return [await relayToMember(ports, idle, text)];
}
