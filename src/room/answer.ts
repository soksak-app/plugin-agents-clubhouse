// The token channel of the room (docs/spec/room.md#answer). A member delivers its answer with the declared command
// soksak-plugin-agents-clubhouse.answer {turn, text}, not through its screen: a program on the alternate screen writes only the rows of
// its visible viewport to the terminal, so no read of the screen or of the retained rows holds an answer taller than the member tab. Each
// turn line carries the token of its turn, and the room accepts each token once, only while it is open, because core gives the handler of
// a command no caller and answers the owner surface for every process of an owned session. The answer of a token raises the delivered
// number of its session to the record length of the line (docs/spec/room.md#room-record), because an accepted submit tells nothing of
// the reading. The open tokens are kept in the tab state, so a token opened before a restart is accepted after it.

export const ANSWER_COMMAND = "soksak-plugin-agents-clubhouse.answer";
// The reply of an accepted answer, which is the last text that the member reads in its turn: a member otherwise writes a summary of
// the sent answer to the person, which costs tokens and which nobody reads. It asks for one character rather than no text, because the
// agent CLI answers a turn that ends with no text by asking for a visible response (docs/spec/room.md#answer).
export const ANSWER_NEXT = "The room has your answer and your turn ended. Nobody reads your terminal: end now with the single text . and nothing else.";

// The state that an answer declares (docs/spec/room.md#settling): `continue` while an open question, a disagreement or work remains, and
// `settled` when the member agrees and its work is done.
export type AnswerStatus = "continue" | "settled";
const STATUSES: readonly string[] = ["continue", "settled"];

export interface Reply {
  text: string;
  status: AnswerStatus;
}

// An open token as the tab state keeps it.
export interface OpenToken {
  turn: string;
  session: string;
  // The identifier of the member of the session.
  member: string;
  // The length of the record when the line was built: the delivered number of the session after the answer.
  count: number;
}

export interface OpenTurn {
  // The token that the line carries as `[@clubhouse] turn <token>`.
  turn: string;
  // Resolves with the answer.
  answer: Promise<Reply>;
  // Ends the token: a later answer of it is refused.
  close(): void;
}

export interface AnswerChannel {
  open(session: string, member: string, count: number): OpenTurn;
  // The handler of the answer command; it throws each refusal.
  deliver(params: unknown): { turn: string };
  // The open tokens in the order in which they opened.
  tokens(): OpenToken[];
  // Whether the session has an open token.
  has(session: string): boolean;
  // Resolves when the session has no open token.
  settled(session: string): Promise<void>;
  // Closes the tokens kept from before a restart, and returns them; the tokens of a running relay stay.
  closeWaits(): OpenToken[];
  // The open turn token of `turn` for a work report, a claim or a release; it throws the refusal for any other token.
  turnOf(params: unknown): OpenToken;
}

export interface AnswerChannelOptions {
  newTurn?: () => string;
  // The open tokens of the tab state; their answers are accepted although no relay waits for them.
  restored?: OpenToken[];
  // Raises the delivered number of the session to count.
  delivered: (session: string, count: number) => void;
  // The answer of a restored turn token, whose relay ended with the restart.
  restoredAnswer: (token: OpenToken, text: string) => void;
  // Runs after each change of the open tokens.
  changed: () => void;
  // Runs when a token closes, by its answer or its close.
  closed?: (token: OpenToken) => void;
}

interface Entry extends OpenToken {
  // The resolver of the relay that waits, or null for a restored token.
  resolve: ((reply: Reply) => void) | null;
}

export function createAnswerChannel(options: AnswerChannelOptions): AnswerChannel {
  const newTurn = options.newTurn ?? (() => crypto.randomUUID());
  const open = new Map<string, Entry>();
  for (const token of options.restored ?? []) open.set(token.turn, { ...token, resolve: null });
  const settleListeners = new Set<() => void>();
  const removed = (turn: string): void => {
    const entry = open.get(turn);
    if (!entry || !open.delete(turn)) return;
    options.closed?.(tokenOf(entry));
    options.changed();
    for (const listener of [...settleListeners]) listener();
  };
  const take = (params: unknown): { entry: Entry; reply: Reply } => {
    const { turn, text, status } = (params ?? {}) as { turn?: unknown; text?: unknown; status?: unknown };
    if (typeof turn !== "string" || turn === "") throw new Error(`turn must be a non-empty string, got ${JSON.stringify(turn)}`);
    if (typeof text !== "string" || text.trim() === "") throw new Error(`text must be a non-empty string, got ${JSON.stringify(text)}`);
    if (!STATUSES.includes(status as string)) throw new Error(`status must be continue or settled, got ${JSON.stringify(status)}`);
    const entry = open.get(turn);
    if (!entry) throw new Error(`turn ${turn} is not an open turn of this room`);
    return { entry, reply: { text, status: status as AnswerStatus } };
  };
  const settle = (entry: Entry, reply: Reply): void => {
    options.delivered(entry.session, entry.count);
    removed(entry.turn);
    if (entry.resolve) entry.resolve(reply);
    else options.restoredAnswer(tokenOf(entry), reply.text);
  };
  return {
    open(session, member, count) {
      for (const entry of open.values()) if (entry.session === session) throw new Error(`session ${session} has an open turn`);
      const turn = newTurn();
      let resolve: (reply: Reply) => void = () => {};
      const answer = new Promise<Reply>((done) => (resolve = done));
      open.set(turn, { turn, session, member, count, resolve });
      options.changed();
      return { turn, answer, close: () => removed(turn) };
    },
    deliver(params) {
      const { entry, reply } = take(params);
      settle(entry, reply);
      return { turn: entry.turn, next: ANSWER_NEXT };
    },
    tokens: () => [...open.values()].map(tokenOf),
    turnOf(params) {
      const turn = (params as { turn?: unknown } | null)?.turn;
      if (typeof turn !== "string" || turn === "") throw new Error(`turn must be a non-empty string, got ${JSON.stringify(turn)}`);
      const entry = open.get(turn);
      if (!entry) throw new Error(`turn ${turn} is not an open turn of this room`);
      return tokenOf(entry);
    },
    has: (session) => [...open.values()].some((entry) => entry.session === session),
    settled(session) {
      return new Promise<void>((resolve) => {
        const check = (): void => {
          if ([...open.values()].some((entry) => entry.session === session)) return;
          settleListeners.delete(check);
          resolve();
        };
        settleListeners.add(check);
        check();
      });
    },
    closeWaits() {
      const closed = [...open.values()].filter((entry) => entry.resolve === null).map(tokenOf);
      for (const token of closed) removed(token.turn);
      return closed;
    },
  };
}

function tokenOf(entry: Entry): OpenToken {
  return { turn: entry.turn, session: entry.session, member: entry.member, count: entry.count };
}
