// The answer channel of the room (docs/spec/room.md#answer). A member delivers its answer with the declared command
// soksak-plugin-agents-clubhouse.answer {turn, text}, not through its screen: a program on the alternate screen writes only the rows of
// its visible viewport to the terminal, so no read of the screen or of the retained rows holds an answer taller than the member tab.
// Each relayed line carries the token of its turn, and the room accepts each token once, only while its turn is open, because core
// gives the handler of a command no caller and answers the owner surface for every process of an owned session.

export const ANSWER_COMMAND = "soksak-plugin-agents-clubhouse.answer";

export interface OpenTurn {
  // The token that the relayed line of the turn carries as `[@clubhouse] turn <token>`.
  turn: string;
  // Resolves with the text of the answer command of the token.
  answer: Promise<string>;
  // Ends the turn: a later answer of its token is refused.
  close(): void;
}

export interface AnswerChannel {
  open(session: string): OpenTurn;
  // The handler of the answer command; it throws each refusal.
  deliver(params: unknown): { turn: string };
}

interface Pending {
  session: string;
  resolve: (text: string) => void;
}

export function createAnswerChannel(newTurn: () => string = () => crypto.randomUUID()): AnswerChannel {
  const open = new Map<string, Pending>();
  return {
    open(session) {
      for (const pending of open.values()) if (pending.session === session) throw new Error(`session ${session} has an open turn`);
      const turn = newTurn();
      let resolve: (text: string) => void = () => {};
      const answer = new Promise<string>((done) => (resolve = done));
      open.set(turn, { session, resolve });
      return { turn, answer, close: () => void open.delete(turn) };
    },
    deliver(params) {
      const { turn, text } = (params ?? {}) as { turn?: unknown; text?: unknown };
      if (typeof turn !== "string" || turn === "") throw new Error(`turn must be a non-empty string, got ${JSON.stringify(turn)}`);
      if (typeof text !== "string" || text.trim() === "") throw new Error(`text must be a non-empty string, got ${JSON.stringify(text)}`);
      const pending = open.get(turn);
      if (!pending) throw new Error(`turn ${turn} is not an open turn of this room`);
      open.delete(turn);
      pending.resolve(text);
      return { turn };
    },
  };
}
