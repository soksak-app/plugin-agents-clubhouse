// The message relay of the room (C5, docs/spec/room.md) over the members' owned sessions. The mode and the mentions of a message decide
// which members receive it and whether their turns run one after another or at the same time. Each relayed line carries the token of
// its turn, and the member delivers its answer with the declared answer command (docs/spec/room.md#answer); the turn ends when the
// answer arrives. Each member receives every line of the room record that it has not received, so every member reads the whole record.
import { relayMemberMessage, type SessionRelayPort } from "./relay";
import { sessionProgram, type SessionCommandPort } from "./session-channel";
import { mentionedMembers } from "./mention";
import { ANSWER_COMMAND, type AnswerChannel, type AnswerStatus } from "./answer";
import type { SubmitQueue } from "./submit-queue";
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
  // The role of the member in the roster, "" without one (docs/spec/room.md#roles).
  role?: string;
}

// The roles that a turn line states to its member when a member of the relay has a role: its own role and the roles of the others.
export function rolesLine(member: NamedRelayMember, members: NamedRelayMember[]): string | null {
  if (!members.some((entry) => (entry.role ?? "") !== "")) return null;
  const roleOf = (entry: NamedRelayMember): string => (entry.role ?? "") || "no role";
  const others = members.filter((entry) => entry.id !== member.id).map((entry) => `${entry.name}: ${roleOf(entry)}`);
  return `[@clubhouse] roles: you are ${roleOf(member)}${others.length > 0 ? `; ${others.join(", ")}` : ""}`;
}

export interface MemberAnswer {
  id: string;
  text: string;
  // The state that the answer declares (docs/spec/room.md#settling).
  status: AnswerStatus;
}

export interface RelayPorts extends SessionCommandPort {
  // The open turns of the members and the handler of the answer command.
  answers: AnswerChannel;
  // The submit queue of each member session.
  lines: SubmitQueue;
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

// Resolves when the session has no open line: a session with an open token waits for its answer or acknowledgement and then for a
// program state that is not working, so the next line never lands in a turn of the program (docs/spec/room.md#room-record). A session
// without an open token resolves at once, and the relay refuses its program state as before.
async function lineFree(ports: RelayPorts, session: string): Promise<void> {
  if (!ports.answers.has(session)) return;
  await ports.answers.settled(session);
  await new Promise<void>((resolve) => {
    let stop: (() => void) | null = null;
    let done = false;
    const check = (value: unknown): void => {
      if (done) return;
      let state: string | null;
      try {
        state = sessionProgram(value, session);
      } catch {
        // A session that core.sessions no longer lists, or a value that the relay cannot read, ends the wait; the relay reports it.
        state = "unreadable";
      }
      if (state === "working") return;
      done = true;
      stop?.();
      resolve();
    };
    check(ports.sessions());
    if (!done) stop = ports.watchSessions(check);
  });
}

// Sends one member the record lines that it has not received, followed by the token of its turn, and resolves with the text of its
// answer command (docs/spec/room.md#room-record). The answer raises the delivered number of the session; `accepted` runs after core
// accepted the submit. A refusal, a turn that is blocked, a session that leaves core.sessions, or a program that reports idle without an
// answer rejects with the member identifier and the reason. The member runs the answer command during its turn, and core answers that
// command after the handler of the room ran, so the answer arrives before the program reports idle.
async function relayToMember(
  ports: RelayPorts,
  member: RelayMember,
  record: RoomRecord,
  accepted: () => void,
  roles: string | null = null,
): Promise<MemberAnswer> {
  await lineFree(ports, member.session);
  const pending = record.pending(member.session, member.id);
  if (pending === null) throw new Error(`member ${member.id}: the room record holds no line that the member has not received`);
  const controller = new AbortController();
  // A value of core.sessions that the relay cannot read ends the turn with this error, so the relay never waits on a bad value.
  let failure: unknown = null;
  // The line is built at the head of the submit queue of the session, from its sent number (docs/spec/room.md#work-reports).
  const port: SessionRelayPort = {
    submit: async (end) => {
      await ports.lines.submit(member.session, () => {
        const lines = record.pending(member.session, member.id);
        if (lines === null) throw new Error("the room record holds no line that the member has not received");
        return { text: `${lines.text} | ${end}`, accepted: () => record.markSent(member.session, lines.count) };
      });
      accepted();
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
    turn = ports.answers.open(member.session, member.id, "answer", pending.count);
  } catch (error) {
    throw new Error(`member ${member.id}: ${messageOf(error)}`);
  }
  // The room waits for the answer of the member from the submit of its line until the turn ends.
  const endWait = ports.waiting(member, "answer");
  const ended = relayMemberMessage(port, `${roles === null ? "" : `${roles} | `}[@clubhouse] turn ${turn.turn}`, { signal: controller.signal }).then(() => {
    throw new Error(`the member ended its turn without an answer: it ran no ${ANSWER_COMMAND}`);
  });
  try {
    const reply = await Promise.race([turn.answer, ended]);
    return { id: member.id, text: reply.text, status: reply.status as AnswerStatus };
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

// The bound of the conversation of one message (docs/spec/room.md#conversation): the largest number of turns that answers start, and
// whether the owner stopped the conversation. `accepted` runs after each submit of the relay that core accepted
// (docs/spec/room.md#room-record).
export interface ConversationBound {
  limit: number;
  stopped(): boolean;
  accepted(): void;
}

const LIMIT_MAX = 64;

// Reads the plugin setting conversationTurns, an integer from 0 to 64, and refuses any other value.
export function conversationTurnsOf(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > LIMIT_MAX) {
    throw new Error(`settings.conversationTurns must be an integer from 0 to ${LIMIT_MAX}, got ${JSON.stringify(value)}`);
  }
  return value as number;
}

interface Turn {
  member: NamedRelayMember;
  // Whether an answer started the turn; those turns count toward the limit.
  byAnswer: boolean;
}

// Queues a turn for each member that the answer of the speaker mentions, in the order of its first mention. A mention of the speaker
// and a member that already waits for a turn of the relay add no turn.
function queueMentions(queue: Turn[], text: string, speaker: NamedRelayMember, members: NamedRelayMember[]): void {
  const others = members.filter((member) => member !== speaker);
  for (const member of mentionedMembers(text, others)) {
    if (!queue.some((turn) => turn.member === member)) queue.push({ member, byAnswer: true });
  }
}

// The members whose last answer of the relay declares `continue`, in member order.
function continuing(answers: MemberAnswer[], members: NamedRelayMember[]): NamedRelayMember[] {
  const last = new Map<string, MemberAnswer["status"]>();
  for (const answer of answers) last.set(answer.id, answer.status);
  return members.filter((member) => last.get(member.id) === "continue");
}

// Runs the waiting turns one after another and appends each answer to the record when it arrives, so the next member receives it. The
// mentions of each answer queue further turns. When no turn waits and a member of the relay declared `continue` in its last answer, the
// room queues a round of every member of the relay in member order (docs/spec/room.md#settling); when every last answer is `settled`,
// the room records that the conversation settled. A stop of the owner or the limit ends the relay before a waiting turn, with a record
// line of the room. A failed turn rejects with the member and the reason, and the turns after it do not run.
async function runTurns(
  ports: RelayPorts,
  queue: Turn[],
  members: NamedRelayMember[],
  record: RoomRecord,
  bound: ConversationBound,
  earlier: MemberAnswer[] = [],
  // false for the turns of the mentioned members of a simul relay, after which the other members still take their turns.
  closing = true,
): Promise<MemberAnswer[]> {
  const answers: MemberAnswer[] = [];
  let started = 0;
  for (;;) {
    if (queue.length === 0) {
      if (!closing) break;
      const open = continuing([...earlier, ...answers], members);
      if (open.length === 0) {
        if (earlier.length + answers.length > 0) record.append("clubhouse", "the conversation settled");
        break;
      }
      queue.push(...members.map((member) => ({ member, byAnswer: true })));
    }
    if (bound.stopped()) {
      record.append("clubhouse", "the conversation ended: the owner stopped it");
      break;
    }
    if (queue[0].byAnswer && started >= bound.limit) {
      const open = continuing([...earlier, ...answers], members);
      record.append(
        "clubhouse",
        open.length > 0
          ? `the conversation ended without settling: it reached the limit of ${bound.limit} member turns; ${open.map((member) => `@${member.name}`).join(", ")} continue`
          : `the conversation ended: it reached the limit of ${bound.limit} member turns`,
      );
      break;
    }
    const turn = queue.shift()!;
    if (turn.byAnswer) started += 1;
    const answer = await relayToMember(ports, turn.member, record, bound.accepted, rolesLine(turn.member, members));
    record.append(turn.member.id, answer.text);
    answers.push(answer);
    if (closing) queueMentions(queue, answer.text, turn.member, members);
  }
  return answers;
}

const turnsOf = (members: NamedRelayMember[]): Turn[] => members.map((member) => ({ member, byAnswer: false }));

// Relays the last message of the owner in the record by the mode of the room (docs/spec/room.md#modes). The members that the message
// mentions take their turns first in mention order, one after another, and the other members follow in member order: one after another
// in turn and facil, at the same time in simul. Without a mention, turn relays to each member in roster order, facil to the first member
// whose session is idle, and simul to every member at the same time. Each member receives the record lines that it has not received
// (docs/spec/room.md#room-record), and each answer is appended to the record. The answers that mention members start the turns of the
// conversation, and the rounds continue while a member declares continue, within the bound (docs/spec/room.md#conversation).
export async function relayInMode(
  ports: RelayPorts,
  mode: RoomMode,
  members: NamedRelayMember[],
  message: string,
  record: RoomRecord,
  bound: ConversationBound,
): Promise<MemberAnswer[]> {
  // The members that the message mentions take their turns first, in mention order, and the other members follow in member order
  // (docs/spec/room.md#mentions); a mention no longer narrows the receivers.
  const mentioned = mentionedMembers(message, members);
  const others = members.filter((member) => !mentioned.includes(member));
  if (mode === "simul") {
    const first = mentioned.length > 0 ? await runTurns(ports, turnsOf(mentioned), members, record, { ...bound, limit: Number.POSITIVE_INFINITY }, [], false) : [];
    if (mentioned.length > 0 && bound.stopped()) {
      record.append("clubhouse", "the conversation ended: the owner stopped it");
      return first;
    }
    const targets = others;
    if (targets.length === 0) return [...first, ...(await runTurns(ports, [], members, record, bound, first))];
    const results = await Promise.allSettled(targets.map((member) => relayToMember(ports, member, record, bound.accepted, rolesLine(member, members))));
    // The answers that arrived are record lines in member order, also when another turn failed.
    for (const [index, result] of results.entries()) if (result.status === "fulfilled") record.append(targets[index].id, result.value.text);
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
    const answers = [...first, ...results.map((result) => (result as PromiseFulfilledResult<MemberAnswer>).value)];
    const queue: Turn[] = [];
    for (const [index, answer] of answers.slice(first.length).entries()) queueMentions(queue, answer.text, targets[index], members);
    return [...answers, ...(await runTurns(ports, queue, members, record, bound, answers))];
  }
  if (mode === "turn" || mentioned.length > 0) return runTurns(ports, turnsOf([...mentioned, ...others]), members, record, bound);
  const sessions = ports.sessions();
  const idle = members.find((member) => sessionProgram(sessions, member.session) === "idle");
  if (!idle) throw new Error("no member is idle");
  return runTurns(ports, turnsOf([idle]), members, record, bound);
}
