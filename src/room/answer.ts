// The token channel of the room (docs/spec/room.md#answer, docs/spec/room.md#closing-delivery). A member delivers its answer with the
// declared command soksak-plugin-agents-clubhouse.answer {turn, text}, not through its screen: a program on the alternate screen writes
// only the rows of its visible viewport to the terminal, so no read of the screen or of the retained rows holds an answer taller than the
// member tab. A member acknowledges a record line with soksak-plugin-agents-clubhouse.record.ack {turn}. Each line carries the token of
// its turn, and the room accepts each token once, only while it is open, because core gives the handler of a command no caller and
// answers the owner surface for every process of an owned session. The answer or the acknowledgement of a token raises the delivered
// number of its session to the record length of the line (docs/spec/room.md#room-record), because an accepted submit tells nothing of
// the reading. The open tokens are kept in the tab state, so a token opened before a restart is accepted after it.

export const ANSWER_COMMAND = "soksak-plugin-agents-clubhouse.answer";
export const RECORD_ACK_COMMAND = "soksak-plugin-agents-clubhouse.record.ack";

// `answer` for the token of a turn, `record` for the token of a record line of the closing delivery.
export type TokenKind = "answer" | "record";

// An open token as the tab state keeps it.
export interface OpenToken {
  turn: string;
  session: string;
  // The identifier of the member of the session.
  member: string;
  kind: TokenKind;
  // The length of the record when the line was built: the delivered number of the session after the answer or the acknowledgement.
  count: number;
}

export interface OpenTurn {
  // The token that the line carries as `[@clubhouse] turn <token>` or `[@clubhouse] record <token>`.
  turn: string;
  // Resolves with the text of the answer, or with "" for the acknowledgement of a record line.
  answer: Promise<string>;
  // Ends the token: a later answer or acknowledgement of it is refused.
  close(): void;
}

export interface AnswerChannel {
  open(session: string, member: string, kind: TokenKind, count: number): OpenTurn;
  // The handler of the answer command; it throws each refusal.
  deliver(params: unknown): { turn: string };
  // The handler of the record acknowledgement command; it throws each refusal.
  ack(params: unknown): { turn: string };
  // The open tokens in the order in which they opened.
  tokens(): OpenToken[];
  // Whether the session has an open token.
  has(session: string): boolean;
  // Resolves when the session has no open token.
  settled(session: string): Promise<void>;
  // Closes the open record tokens and the tokens kept from before a restart, and returns them; the tokens of a running relay stay.
  closeWaits(): OpenToken[];
}

export interface AnswerChannelOptions {
  newTurn?: () => string;
  // The open tokens of the tab state; their answers and acknowledgements are accepted although no relay waits for them.
  restored?: OpenToken[];
  // Raises the delivered number of the session to count.
  delivered: (session: string, count: number) => void;
  // The answer of a restored turn token, whose relay ended with the restart.
  restoredAnswer: (token: OpenToken, text: string) => void;
  // Runs after each change of the open tokens.
  changed: () => void;
}

interface Entry extends OpenToken {
  // The resolver of the relay that waits, or null for a restored token.
  resolve: ((text: string) => void) | null;
}

export function createAnswerChannel(options: AnswerChannelOptions): AnswerChannel {
  const newTurn = options.newTurn ?? (() => crypto.randomUUID());
  const open = new Map<string, Entry>();
  for (const token of options.restored ?? []) open.set(token.turn, { ...token, resolve: null });
  const settleListeners = new Set<() => void>();
  const removed = (turn: string): void => {
    if (!open.delete(turn)) return;
    options.changed();
    for (const listener of [...settleListeners]) listener();
  };
  const take = (params: unknown, kind: TokenKind): { entry: Entry; text: string } => {
    const { turn, text } = (params ?? {}) as { turn?: unknown; text?: unknown };
    if (typeof turn !== "string" || turn === "") throw new Error(`turn must be a non-empty string, got ${JSON.stringify(turn)}`);
    if (kind === "answer" && (typeof text !== "string" || text.trim() === "")) {
      throw new Error(`text must be a non-empty string, got ${JSON.stringify(text)}`);
    }
    const entry = open.get(turn);
    if (!entry) throw new Error(kind === "answer" ? `turn ${turn} is not an open turn of this room` : `turn ${turn} is not an open record line of this room`);
    if (entry.kind !== kind) {
      throw new Error(
        entry.kind === "record"
          ? `turn ${turn} is a record line: acknowledge it with ${RECORD_ACK_COMMAND}`
          : `turn ${turn} is a turn: answer it with ${ANSWER_COMMAND}`,
      );
    }
    return { entry, text: kind === "answer" ? (text as string) : "" };
  };
  const settle = (entry: Entry, text: string): void => {
    options.delivered(entry.session, entry.count);
    removed(entry.turn);
    if (entry.resolve) entry.resolve(text);
    else if (entry.kind === "answer") options.restoredAnswer(tokenOf(entry), text);
  };
  return {
    open(session, member, kind, count) {
      for (const entry of open.values()) if (entry.session === session) throw new Error(`session ${session} has an open turn`);
      const turn = newTurn();
      let resolve: (text: string) => void = () => {};
      const answer = new Promise<string>((done) => (resolve = done));
      open.set(turn, { turn, session, member, kind, count, resolve });
      options.changed();
      return { turn, answer, close: () => removed(turn) };
    },
    deliver(params) {
      const { entry, text } = take(params, "answer");
      settle(entry, text);
      return { turn: entry.turn };
    },
    ack(params) {
      const { entry } = take(params, "record");
      settle(entry, "");
      return { turn: entry.turn };
    },
    tokens: () => [...open.values()].map(tokenOf),
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
      const closed = [...open.values()].filter((entry) => entry.kind === "record" || entry.resolve === null).map(tokenOf);
      for (const token of closed) removed(token.turn);
      return closed;
    },
  };
}

function tokenOf(entry: Entry): OpenToken {
  return { turn: entry.turn, session: entry.session, member: entry.member, kind: entry.kind, count: entry.count };
}
