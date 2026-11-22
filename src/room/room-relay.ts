// The message relay of the room (C5, docs/spec/room.md) over the members' owned sessions. The mode and the mentions of a message decide
// which members receive it and whether their turns run one after another or at the same time. Each relayed line carries the token of
// its turn, and the member delivers its answer with the declared answer command (docs/spec/room.md#answer); the turn ends when the
// answer arrives (docs/spec/room.md#turn-end). Each turn line carries every line of the room record that its member has not received, and
// the record reaches a member in no other line (docs/spec/room.md#conversation-first).
import { sessionProgram, type SessionCommandPort } from "./session-channel";
import { mentionedMembers } from "./mention";
import type { AnswerChannel, AnswerStatus } from "./answer";
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
// The rule of each turn line (docs/spec/room.md#room-protocol): the room cannot read the terminal of a member.
// The preface of a turn line, before the record lines that the member has not received, and the room line of a turn of a member that
// has received every record line, which still runs and takes an answer with a status (docs/spec/room.md#modes).
export const TURN_TEXT = "네 차례야. 아래는 네가 아직 못 본 기록이야.";
export const EMPTY_TURN_TEXT = "네 차례야. 네가 아직 못 본 기록은 없어.";
export const TURN_RULE = "answer through the room only: reply to the speakers, put a message to the owner in @owner:, write nothing in your terminal";

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
  // The milliseconds from the submit of the turn line to the arrival of the answer (docs/spec/room.md#timing).
  elapsedMs: number;
  // The index of the record line of the answer, once the room appended it.
  index?: number;
}

// Appends the answer to the record and keeps the index of its line.
function appendAnswer(record: RoomRecord, answer: MemberAnswer): void {
  record.append(answer.id, answer.text, answer.elapsedMs);
  answer.index = record.lines.length - 1;
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
  // Resolves when the last write of the tab state has completed, and rejects with its failure (docs/spec/room.md#restart).
  persisted(): Promise<void>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Resolves true when the session has no open turn and its program is not blocked: a session with an open token waits for its answer, and
// a blocked session waits for the next value of core.sessions that shows it not blocked, because a question of its program would take
// the line as its answer (docs/spec/room.md#turn-end). An idle or a working session takes the line at once, because the program queues
// a line typed while it works. The wait is the step `turn` of the conversation status. A stop of the owner ends the wait with false.
async function lineFree(ports: RelayPorts, member: RelayMember, stopping?: ConversationBound["stopping"]): Promise<boolean> {
  const session = member.session;
  if (ports.answers.has(session)) await ports.answers.settled(session);
  const stateOf = (value: unknown): string => {
    try {
      return sessionProgram(value, session) ?? "none";
    } catch {
      // A session that core.sessions no longer lists, or a value that the relay cannot read, ends the wait; the turn reports it.
      return "unreadable";
    }
  };
  if (stateOf(ports.sessions()) !== "blocked") return true;
  const endWait = ports.waiting(member, "turn");
  try {
    return await new Promise<boolean>((resolve) => {
      let done = false;
      const end = (free: boolean): void => {
        if (done) return;
        done = true;
        stopWatch();
        stopStop();
        resolve(free);
      };
      const stopWatch = ports.watchSessions((value) => {
        if (stateOf(value) !== "blocked") end(true);
      });
      const stopStop = stopping ? stopping(() => end(false)) : () => {};
    });
  } finally {
    endWait();
  }
}

// Sends one member its turn line, the turn preface with the record lines that it has not received or the room line of an empty turn,
// followed by the token of its turn, and resolves with its answer (docs/spec/room.md#modes). The answer ends the turn and raises the
// delivered number of the session; the room reads no program state to end the turn (docs/spec/room.md#turn-end). `accepted` runs after
// core accepted the submit. A refused submit and a session that leaves core.sessions reject with the member identifier and the reason,
// and a stop of the owner rejects with TurnStopped.
async function relayToMember(
  ports: RelayPorts,
  member: RelayMember,
  record: RoomRecord,
  accepted: () => void,
  roles: string | null = null,
  stopping?: ConversationBound["stopping"],
): Promise<MemberAnswer> {
  if (!(await lineFree(ports, member, stopping))) throw new TurnStopped();
  let turn;
  try {
    turn = ports.answers.open(member.session, member.id, record.length(member.session));
  } catch (error) {
    throw new Error(`member ${member.id}: ${messageOf(error)}`);
  }
  // The tab state that holds the token is written before the line is submitted, so a reload of the page never leaves the member with a
  // token that the next page cannot restore (docs/spec/room.md#restart).
  try {
    await ports.persisted();
  } catch (error) {
    turn.close();
    throw new Error(`member ${member.id}: the tab state with its turn token was not written: ${messageOf(error)}`);
  }
  const end = `${roles === null ? "" : `${roles} | `}[@clubhouse] ${TURN_RULE} | [@clubhouse] turn ${turn.turn}`;
  let submittedAt = 0;
  // The room waits for the answer of the member from the submit of its line until the turn ends.
  const endWait = ports.waiting(member, "answer");
  const stops: (() => void)[] = [];
  try {
    const ended = new Promise<never>((_resolve, reject) => {
      // A session that core.sessions no longer lists, or a value that the relay cannot read, ends the turn with its error.
      stops.push(ports.watchSessions((value) => {
        try {
          sessionProgram(value, member.session);
        } catch (error) {
          reject(error);
        }
      }));
      if (stopping) stops.push(stopping(() => reject(new TurnStopped())));
    });
    // The line is built at the head of the submit queue of the session, from its sent number (docs/spec/room.md#work-reports).
    const submitted = ports.lines
      .submit(member.session, () => {
        const lines = record.pending(member.session, member.id);
        const count = lines === null ? record.length(member.session) : lines.count;
        return {
          text: `[@clubhouse] ${lines === null ? EMPTY_TURN_TEXT : `${TURN_TEXT} | ${lines.text}`} | ${end}`,
          accepted: () => {
            submittedAt = record.now();
            record.markSent(member.session, count);
          },
        };
      })
      .then(() => accepted());
    // The submit ends no turn: after it the turn waits for the answer.
    const submitWatch = submitted.then(() => new Promise<never>(() => {}));
    ended.catch(() => {});
    submitWatch.catch(() => {});
    const reply = await Promise.race([turn.answer, ended, submitWatch]);
    return { id: member.id, text: reply.text, status: reply.status as AnswerStatus, elapsedMs: record.now() - submittedAt };
  } catch (error) {
    if (error instanceof TurnStopped) throw error;
    throw new Error(`member ${member.id}: ${messageOf(error)}`);
  } finally {
    for (const stop of stops) stop();
    endWait();
    turn.close();
  }
}

// The bound of the conversation of one message (docs/spec/room.md#conversation): the largest number of turns that answers start, and
// whether the owner stopped the conversation. `accepted` runs after each submit of the relay that core accepted
// (docs/spec/room.md#room-record).
export interface ConversationBound {
  limit: number;
  stopped(): boolean;
  accepted(): void;
  // Subscribes to the stop of the owner, which ends a turn that waits for a blocked session or for its answer; the returned function
  // ends the subscription.
  stopping?: (listener: () => void) => () => void;
  // The identifier of the leader among the members; a relay with a leader follows the leader rules (docs/spec/room.md#leader).
  leader?: string;
  // The members of the relay at each step, which grow when the leader summons a member during the relay; the given members otherwise.
  members?: () => NamedRelayMember[];
}

// The stop of the owner ended a turn that waited for a blocked session or for its answer.
class TurnStopped extends Error {
  constructor() {
    super("the owner stopped the conversation");
  }
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

// Whether the member has record lines that it has not received other than the settled answers of this relay: each answer is a line
// that the other members have not received, so a turn for each settled answer would never end (docs/spec/room.md#settling).
function unreceivedBesidesSettled(record: RoomRecord, member: RelayMember, answers: MemberAnswer[]): boolean {
  const settled = new Set(answers.filter((answer) => answer.status === "settled").map((answer) => answer.index));
  return record.unsent(member.session, member.id).some((index) => !settled.has(index));
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
  // The record length at the start of the last turn of each member: an owner line after it has not been answered by that member.
  const turnStart = new Map<string, number>();
  const lastOwner = (): number => record.lines.map((line) => line.speaker).lastIndexOf("owner");
  for (;;) {
    if (queue.length === 0) {
      if (!closing) break;
      const open = continuing([...earlier, ...answers], members);
      // A member that took its turn before an owner line of the relay takes another turn, so every member answers it
      // (docs/spec/room.md#owner-follow-up), and so does a member with record lines that it has not received other than settled answers
      // (docs/spec/room.md#settling).
      const unanswered = members.filter(
        (member) => (turnStart.has(member.id) && turnStart.get(member.id)! <= lastOwner()) ||
          // Only a member that took part in the relay: in facil the other members take no turn.
          ([...earlier, ...answers].some((answer) => answer.id === member.id) && unreceivedBesidesSettled(record, member, [...earlier, ...answers])),
      );
      if (open.length === 0 && unanswered.length === 0) {
        if (earlier.length + answers.length > 0) record.append("clubhouse", "the conversation settled");
        break;
      }
      queue.push(...(open.length > 0 ? members : unanswered).map((member) => ({ member, byAnswer: true })));
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
    turnStart.set(turn.member.id, record.lines.length);
    let answer: MemberAnswer;
    try {
      answer = await relayToMember(ports, turn.member, record, bound.accepted, rolesLine(turn.member, members), bound.stopping);
    } catch (error) {
      if (!(error instanceof TurnStopped)) throw error;
      record.append("clubhouse", "the conversation ended: the owner stopped it");
      break;
    }
    appendAnswer(record, answer);
    answers.push(answer);
    if (closing) queueMentions(queue, answer.text, turn.member, members);
  }
  return answers;
}

// Runs the relay of a room with a leader (docs/spec/room.md#leader): the members that the owner mentions and then the leader take the
// first turns; the workers that one answer of the leader mentions start together, and each answer is appended when it arrives
// (docs/spec/room.md#addressed-views). When no turn waits, each worker of the relay with unreceived lines other than settled answers takes
// a turn, and then the leader while it has unreceived lines or its last answer continues; the last answer `settled` of the leader with
// every line received settles the conversation (docs/spec/room.md#settling).
async function runLeader(
  ports: RelayPorts,
  leader: NamedRelayMember,
  given: NamedRelayMember[],
  message: string,
  record: RoomRecord,
  bound: ConversationBound,
): Promise<MemberAnswer[]> {
  const members = (): NamedRelayMember[] => bound.members?.() ?? given;
  const workers = (): NamedRelayMember[] => members().filter((member) => member.id !== leader.id);
  const answers: MemberAnswer[] = [];
  const batches: { members: NamedRelayMember[]; byAnswer: boolean }[] = [
    ...mentionedMembers(message, workers()).map((member) => ({ members: [member], byAnswer: false })),
    { members: [leader], byAnswer: false },
  ];
  const queued = (member: NamedRelayMember): boolean => batches.some((batch) => batch.members.some((one) => one.id === member.id));
  let started = 0;
  for (;;) {
    if (batches.length === 0) {
      const took = new Set(answers.map((answer) => answer.id));
      const behind = workers().filter((member) => took.has(member.id) && unreceivedBesidesSettled(record, member, answers));
      const last = answers.filter((answer) => answer.id === leader.id).at(-1);
      if (behind.length > 0) batches.push(...behind.map((member) => ({ members: [member], byAnswer: true })));
      else if (last?.status === "settled" && record.unsent(leader.session, leader.id).length === 0) {
        record.append("clubhouse", "the conversation settled");
        break;
      } else batches.push({ members: [leader], byAnswer: true });
    }
    if (bound.stopped()) {
      record.append("clubhouse", "the conversation ended: the owner stopped it");
      break;
    }
    const batch = batches[0];
    if (batch.byAnswer && started + batch.members.length > bound.limit) {
      record.append("clubhouse", `the conversation ended: it reached the limit of ${bound.limit} member turns`);
      break;
    }
    batches.shift();
    if (batch.byAnswer) started += batch.members.length;
    const arrived: MemberAnswer[] = [];
    const results = await Promise.allSettled(
      batch.members.map((member) =>
        relayToMember(ports, member, record, bound.accepted, rolesLine(member, members()), bound.stopping).then((answer) => {
          appendAnswer(record, answer);
          answers.push(answer);
          arrived.push(answer);
        }),
      ),
    );
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected" && !(result.reason instanceof TurnStopped));
    if (failed) throw failed.reason;
    if (results.some((result) => result.status === "rejected")) {
      record.append("clubhouse", "the conversation ended: the owner stopped it");
      break;
    }
    for (const answer of arrived) {
      const named = mentionedMembers(answer.text, workers().filter((member) => member.id !== answer.id && !queued(member)));
      if (named.length === 0) continue;
      if (answer.id === leader.id) batches.push({ members: named, byAnswer: true });
      else batches.push(...named.map((member) => ({ members: [member], byAnswer: true })));
    }
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
  const leader = members.find((member) => member.id === bound.leader);
  if (leader !== undefined) return runLeader(ports, leader, members, message, record, bound);
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
    const results = await Promise.allSettled(
      targets.map((member) => relayToMember(ports, member, record, bound.accepted, rolesLine(member, members), bound.stopping)),
    );
    // The answers that arrived are record lines in member order, also when another turn failed.
    for (const [index, result] of results.entries()) if (result.status === "fulfilled") appendAnswer(record, result.value);
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected" && !(result.reason instanceof TurnStopped));
    if (failed) throw failed.reason;
    if (results.some((result) => result.status === "rejected")) {
      record.append("clubhouse", "the conversation ended: the owner stopped it");
      return [...first, ...results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))];
    }
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
