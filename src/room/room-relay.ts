// The message relay of the room (C5, docs/spec/room.md) over the members' owned sessions. The mode and the mentions of a message decide
// which members receive it and whether their turns run one after another or at the same time. Each relayed line carries the token of
// its turn, and the member delivers its answer with the declared answer command (docs/spec/room.md#answer); the turn ends when the
// answer arrives. Each member receives every line of the room record that it has not received, so every member reads the whole record.
import { relayMemberMessage, type SessionRelayPort } from "./relay";
import { sessionProgram, sessionSubmit, type SessionCommandPort } from "./session-channel";
import { mentionedMembers } from "./mention";
import { ANSWER_COMMAND, type AnswerChannel } from "./answer";
import type { RoomMode } from "./commands";
import type { RoomRecord } from "./room-record";
import type { BeginWaiting } from "./conversation-status";

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
  // The open turns of the members and the handler of the answer command.
  answers: AnswerChannel;
  // The surface of the room, which the answer command of a member names.
  surface: string;
  // The current value of core.sessions, the list of open sessions.
  sessions(): unknown;
  // Calls the listener with each new value of core.sessions; the returned function ends the watch.
  watchSessions(listener: (value: unknown) => void): () => void;
  // Names a member whose turn the room waits for in the conversation status (docs/spec/room.md#conversation-status).
  waiting: BeginWaiting;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Sends one member the record lines that it has not received, followed by the token of its turn, and resolves with the text of its
// answer command (docs/spec/room.md#room-record). An accepted submit sets the delivered number of the session. A refusal, a turn that is
// blocked, a session that leaves core.sessions, or a program that reports idle without an answer rejects with the member identifier and
// the reason. The member runs the answer command during its turn, and core answers that command after the handler of the room ran, so
// the answer arrives before the program reports idle.
async function relayToMember(ports: RelayPorts, member: RelayMember, record: RoomRecord): Promise<MemberAnswer> {
  const pending = record.pending(member.session, member.id);
  if (pending === null) throw new Error(`member ${member.id}: the room record holds no line that the member has not received`);
  const controller = new AbortController();
  // A value of core.sessions that the relay cannot read ends the turn with this error, so the relay never waits on a bad value.
  let failure: unknown = null;
  const submit = sessionSubmit(ports, member.session);
  const port: SessionRelayPort = {
    submit: async (line) => {
      await submit(line);
      record.markDelivered(member.session, pending.count);
    },
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
  let turn;
  try {
    turn = ports.answers.open(member.session);
  } catch (error) {
    throw new Error(`member ${member.id}: ${messageOf(error)}`);
  }
  // The room waits for the answer of the member from the submit of its line until the turn ends.
  const endWait = ports.waiting(member, "answer");
  const ended = relayMemberMessage(port, `${pending.text} | [@clubhouse] turn ${turn.turn}`, { signal: controller.signal }).then(() => {
    throw new Error(`the member ended its turn without an answer: it ran no ${ANSWER_COMMAND}`);
  });
  try {
    return { id: member.id, text: await Promise.race([turn.answer, ended]) };
  } catch (error) {
    throw new Error(`member ${member.id}: ${messageOf(failure ?? error)}`);
  } finally {
    endWait();
    turn.close();
    // The answer ended the turn: the watch of the program ends, and its abort is no failure.
    ended.catch(() => {});
    controller.abort();
  }
}

// Relays to each member in order and appends each answer to the record when it arrives, so the next member receives it with the
// message. A failed turn rejects with the member and the reason, and the members after it receive nothing.
async function relayInTurn(ports: RelayPorts, members: RelayMember[], record: RoomRecord): Promise<MemberAnswer[]> {
  const answers: MemberAnswer[] = [];
  for (const member of members) {
    const answer = await relayToMember(ports, member, record);
    record.append(member.id, answer.text);
    answers.push(answer);
  }
  return answers;
}

// Relays the last message of the owner in the record by the mode of the room (docs/spec/room.md#modes). A message that mentions members
// goes only to them in mention order: one after another in turn and facil, at the same time in simul. Without a mention, turn relays to
// each member in roster order, facil to the first member whose session is idle, and simul to every member at the same time. Each member
// receives the record lines that it has not received (docs/spec/room.md#room-record), and each answer is appended to the record.
export async function relayInMode(
  ports: RelayPorts,
  mode: RoomMode,
  members: NamedRelayMember[],
  message: string,
  record: RoomRecord,
): Promise<MemberAnswer[]> {
  const mentioned = mentionedMembers(message, members);
  if (mode === "simul") {
    const targets = mentioned.length > 0 ? mentioned : members;
    const results = await Promise.allSettled(targets.map((member) => relayToMember(ports, member, record)));
    // The answers that arrived are record lines in member order, also when another turn failed.
    for (const [index, result] of results.entries()) if (result.status === "fulfilled") record.append(targets[index].id, result.value.text);
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
    return results.map((result) => (result as PromiseFulfilledResult<MemberAnswer>).value);
  }
  if (mentioned.length > 0) return relayInTurn(ports, mentioned, record);
  if (mode === "turn") return relayInTurn(ports, members, record);
  const sessions = ports.sessions();
  const idle = members.find((member) => sessionProgram(sessions, member.session) === "idle");
  if (!idle) throw new Error("no member is idle");
  return relayInTurn(ports, [idle], record);
}
