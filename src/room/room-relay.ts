// The message relay of the room (C5, docs/spec/room.md) over the members' owned sessions. The mentions of a message and the leader of the
// group decide which members receive it (docs/spec/room.md#receivers). Each relayed line carries the token of
// its turn, and the member delivers its answer with the declared answer command (docs/spec/room.md#answer); the turn ends when the
// answer arrives (docs/spec/room.md#turn-end). Each turn line carries every line of the room record that its member has not received, and
// the record reaches a member in no other line (docs/spec/room.md#conversation-first).
import { formatISO } from "date-fns";
import { sessionProgram, type SessionCommandPort } from "./session-channel";
import { mentionedMembers, mentionsAll } from "./mention";
import type { AnswerChannel, AnswerStatus } from "./answer";
import type { SubmitQueue } from "./submit-queue";
import type { RoomRecord } from "./room-record";
import type { BeginWaiting } from "./conversation-status";

export interface RelayMember {
  id: string;
  // The owned session of the member (the summon relation of C3).
  session: string;
}

export interface NamedRelayMember extends RelayMember {
  // The name of the definition of the member, which a mention may use.
  name: string;
}

// A member of the group of the room: its open session that received the room protocol, or null until its first turn opens one
// (docs/spec/room.md#receivers).
export interface RelayGroupMember {
  id: string;
  name: string;
  session: string | null;
}

// The rule of each turn line (docs/spec/room.md#room-protocol): the room cannot read the terminal of a member.
// The preface of a turn line, before the record lines that the member has not received, and the room line of a turn of a member that
// has received every record line, which still runs and takes an answer with a status (docs/spec/room.md#modes).
export const TURN_TEXT = "네 차례야. 아래는 네가 아직 못 본 기록이야.";
export const EMPTY_TURN_TEXT = "네 차례야. 네가 아직 못 본 기록은 없어.";
// A member that writes a note while its background agents run spends tokens on text that nobody reads, so the rule names that case
// (docs/spec/room.md#room-protocol).
export const TURN_RULE = "answer through the room only: reply to the speakers, put a message to the owner in @owner:, end every step with the single text . and nothing else, also while background work runs";

export interface MemberAnswer {
  id: string;
  text: string;
  // The state that the answer declares (docs/spec/room.md#settling).
  status: AnswerStatus;
  // The milliseconds from the submit of the turn line to the arrival of the answer (docs/spec/room.md#timing).
  elapsedMs: number;
  // The index sentence of the answer (docs/spec/room.md#index-sentence).
  index: string;
  // The position of the record line of the answer, once the room appended it.
  line?: number;
}

// Appends the answer to the record and keeps the index of its line.
function appendAnswer(record: RoomRecord, answer: MemberAnswer): void {
  record.append(answer.id, answer.text, { elapsedMs: answer.elapsedMs, index: answer.index });
  answer.line = record.lines.length - 1;
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
  // Opens the session of a member without one: summons it, arranges its tab and submits the room protocol, and resolves with the
  // session; it rejects with the reason when the member does not start (docs/spec/room.md#receivers).
  open(member: { id: string; name: string }): Promise<string>;
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
  const end = `[@clubhouse] ${TURN_RULE} | [@clubhouse] turn ${turn.turn}`;
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
        // The lines that the bound left out are named, so the member reads them from the conversation status (docs/spec/room.md#mentions).
        const left = lines?.left ?? null;
        const time = (at: number | null): string => (at === null ? "-" : formatISO(at));
        const note = left === null ? "" :
          `[@clubhouse] ${left.count} earlier lines for you, entries ${left.first} to ${left.last} of the conversation from ${time(left.firstAt)} to ${time(left.lastAt)}, are not in this line; read them with sok status soksak-plugin-agents-clubhouse.conversation --surface ${ports.surface} | `;
        return {
          text: `[@clubhouse] ${lines === null ? EMPTY_TURN_TEXT : `${TURN_TEXT} | ${note}${lines.text}`} | ${end}`,
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
    return { id: member.id, text: reply.text, status: reply.status as AnswerStatus, elapsedMs: record.now() - submittedAt, index: reply.index };
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
  // The identifier of the leader of the group, which receives every message of the owner (docs/spec/room.md#leader).
  leader: string;
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

// Whether the member has record lines that it has not received other than the settled answers of this relay: each answer is a line
// that the other members have not received, so a turn for each settled answer would never end (docs/spec/room.md#settling).
function unreceivedBesidesSettled(record: RoomRecord, member: RelayMember, answers: MemberAnswer[]): boolean {
  const settled = new Set(answers.filter((answer) => answer.status === "settled").map((answer) => answer.line));
  return record.unsent(member.session, member.id).some((index) => !settled.has(index));
}

// The members whose last answer of the relay declares `continue`, in member order.
function continuing<T extends { id: string }>(answers: MemberAnswer[], members: T[]): T[] {
  const last = new Map<string, MemberAnswer["status"]>();
  for (const answer of answers) last.set(answer.id, answer.status);
  return members.filter((member) => last.get(member.id) === "continue");
}

// Runs the relay of a room with a leader (docs/spec/room.md#leader): the members that the owner mentions and then the leader take the
// first turns; the workers that one answer of the leader mentions start together, and each answer is appended when it arrives
// (docs/spec/room.md#addressed-views). When no turn waits, each worker of the relay with unreceived lines other than settled answers takes
// a turn, and then the leader while it has unreceived lines; the conversation settles when the last answer of every member of the relay
// is `settled`, and waits for the owner while one continues, because the status of the leader counts like every other
// (docs/spec/room.md#settling).
async function runLeader(
  ports: RelayPorts,
  leader: RelayGroupMember,
  members: RelayGroupMember[],
  message: string,
  record: RoomRecord,
  bound: ConversationBound,
): Promise<MemberAnswer[]> {
  const workers = (): RelayGroupMember[] => members.filter((member) => member.id !== leader.id);
  const answers: MemberAnswer[] = [];
  // The session of each member of the relay: its open session, or the session that its first turn opened (docs/spec/room.md#receivers).
  const opened = new Map<string, string>();
  for (const member of members) if (member.session !== null) opened.set(member.id, member.session);
  const live = (member: RelayGroupMember): NamedRelayMember | null => {
    const session = opened.get(member.id);
    return session === undefined ? null : { id: member.id, name: member.name, session };
  };
  const ready = async (member: RelayGroupMember): Promise<NamedRelayMember> => {
    const known = live(member);
    if (known !== null) return known;
    const session = await ports.open({ id: member.id, name: member.name });
    opened.set(member.id, session);
    return { id: member.id, name: member.name, session };
  };
  // An owner `@all` adds every worker that the message does not name in one batch after the named workers (docs/spec/room.md#mentions).
  const { named, rest } = ownerTurns(message, members, leader.id);
  const batches: { members: RelayGroupMember[]; byAnswer: boolean }[] = [
    ...named.map((member) => ({ members: [member], byAnswer: false })),
    ...(rest.length > 0 ? [{ members: rest, byAnswer: false }] : []),
    { members: [leader], byAnswer: false },
  ];
  const queued = (member: RelayGroupMember): boolean => batches.some((batch) => batch.members.some((one) => one.id === member.id));
  let started = 0;
  for (;;) {
    if (batches.length === 0) {
      const took = new Set(answers.map((answer) => answer.id));
      const behind = workers().filter((member) => {
        const one = live(member);
        return took.has(member.id) && one !== null && unreceivedBesidesSettled(record, one, answers);
      });
      const open = continuing(answers, members);
      if (behind.length > 0) batches.push(...behind.map((member) => ({ members: [member], byAnswer: true })));
      else if (live(leader) !== null && record.unsent(live(leader)!.session, leader.id).length > 0) batches.push({ members: [leader], byAnswer: true });
      else if (open.length === 0) {
        record.append("clubhouse", "the conversation settled");
        break;
      } else {
        // A turn without an unreceived line gives a member nothing to answer, so a member that continues waits for the owner.
        record.append("clubhouse", `the conversation waits for the owner: ${open.map((member) => `@${member.name}`).join(", ")} continue`);
        break;
      }
    }
    if (bound.stopped()) {
      record.append("clubhouse", "the conversation ended: the owner stopped it");
      break;
    }
    const batch = batches[0];
    if (batch.byAnswer && started + batch.members.length > bound.limit) {
      const open = continuing(answers, members);
      record.append(
        "clubhouse",
        open.length > 0
          ? `the conversation ended without settling: it reached the limit of ${bound.limit} member turns; ${open.map((member) => `@${member.name}`).join(", ")} continue`
          : `the conversation ended: it reached the limit of ${bound.limit} member turns`,
      );
      break;
    }
    batches.shift();
    if (batch.byAnswer) started += batch.members.length;
    const arrived: MemberAnswer[] = [];
    // A member without a session opens it before the turn line of its first turn.
    const turnMembers: NamedRelayMember[] = [];
    for (const member of batch.members) turnMembers.push(await ready(member));
    const results = await Promise.allSettled(
      turnMembers.map((member) =>
        relayToMember(ports, member, record, bound.accepted, bound.stopping).then((answer) => {
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
      const free = workers().filter((member) => member.id !== answer.id && !queued(member));
      const named = mentionedMembers(answer.text, free);
      if (answer.id === leader.id) {
        // A leader `@all` starts every worker with the named workers first, in one batch.
        const all = mentionsAll(answer.text) ? [...named, ...free.filter((member) => !named.includes(member))] : named;
        if (all.length > 0) batches.push({ members: all, byAnswer: true });
        continue;
      }
      // A worker `@all` addresses the line and starts no turn; a mention of the leader gives the leader the next turn.
      if (mentionedMembers(answer.text, [leader]).length > 0 && !queued(leader)) batches.unshift({ members: [leader], byAnswer: true });
      batches.push(...named.map((member) => ({ members: [member], byAnswer: true })));
    }
  }
  return answers;
}

// The turns that a message of the owner starts among the members (docs/spec/room.md#receivers): the mentioned workers one after another
// in the order of their first mention, every other worker in one batch after them when the message mentions `@all`, and the leader last.
function ownerTurns<T extends { id: string; name: string }>(message: string, members: T[], leader: string): { named: T[]; rest: T[]; leader: T[] } {
  const workers = members.filter((member) => member.id !== leader);
  const named = mentionedMembers(message, workers);
  const rest = mentionsAll(message) ? workers.filter((member) => !named.includes(member)) : [];
  return { named, rest, leader: members.filter((member) => member.id === leader) };
}

// Relays the last message of the owner in the record to its receivers (docs/spec/room.md#receivers) and runs the conversation that their
// answers start (docs/spec/room.md#conversation). `members` are the members of the group; a member without a session opens it through
// `ports.open` when its first turn starts.
export async function relayMessage(
  ports: RelayPorts,
  members: RelayGroupMember[],
  message: string,
  record: RoomRecord,
  bound: ConversationBound,
): Promise<MemberAnswer[]> {
  const leader = members.find((member) => member.id === bound.leader);
  if (leader === undefined) throw new Error(`the leader ${bound.leader} is no member of the group`);
  return runLeader(ports, leader, members, message, record, bound);
}
