// The work reports and the path claims of the members (docs/spec/room.md#work-reports). A member reports, claims and releases with the
// token of its open turn, which proves the member, and the turn goes on. Each report, claim and release is a record line of the member,
// `(report) <text>`, `(claim) <paths>` or `(release) <paths>`, which each other member reads in its next turn line
// (docs/spec/room.md#conversation-first). Outside a turn the room injects only an owner line that the owner sent during a relay, as an
// owner instruction, into each working session, and into a blocked session when the event of core.sessions shows it working again
// (docs/spec/room.md#owner-follow-up). The room decides each claim at once in the
// handler, which runs to its end before another handler, so two overlapping claims never both succeed. The claims of a turn are released
// when the turn closes.
import { sessionProgram } from "./session-channel";
import type { AnswerChannel, OpenToken } from "./answer";
import type { RoomRecord } from "./room-record";
import type { SubmitQueue } from "./submit-queue";

export const REPORT_COMMAND = "soksak-plugin-agents-clubhouse.report";
export const CLAIM_COMMAND = "soksak-plugin-agents-clubhouse.claim";
export const RELEASE_COMMAND = "soksak-plugin-agents-clubhouse.release";

// The preface of the injected line that holds an owner line, which the owner sent during the relay (docs/spec/room.md#owner-follow-up).
export const OWNER_INJECT_TEXT = "[@clubhouse] 방장의 새 지시야. 하던 작업에 반영하고 다음 답에서 답해.";

export interface WorkMember {
  id: string;
  session: string;
}

export interface WorkPorts {
  answers: AnswerChannel;
  lines: SubmitQueue;
  // The current value of core.sessions.
  sessions(): unknown;
  report(where: string, text: string): void;
}

export interface WorkReports {
  reportCommand(params: unknown): { turn: string };
  claim(params: unknown): { turn: string; paths: string[] };
  release(params: unknown): { turn: string; paths: string[] };
  // Releases the claims of a closed turn token.
  closed(token: OpenToken): void;
  // Marks the last record line, an owner line that the owner sent during a relay, as a follow-up and injects it.
  followUp(): void;
  // Injects the unsent lines into each working session whose unsent lines hold a follow-up; the room calls it at each value of
  // core.sessions.
  inject(): void;
  // The claimed paths and their members.
  claims(): { path: string; member: string }[];
}

const overlaps = (a: string, b: string): boolean => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

function pathsOf(params: unknown): string[] {
  const paths = (params as { paths?: unknown } | null)?.paths;
  if (!Array.isArray(paths) || paths.length === 0 || !paths.every((path) => typeof path === "string" && path.trim() !== "")) {
    throw new Error(`paths must be a non-empty array of non-empty strings, got ${JSON.stringify(paths)}`);
  }
  return [...new Set(paths.map((path: string) => path.trim().replace(/\/+$/, "")))];
}

// `members` gives the sessions of the delivery: the checked members whose session core.sessions lists and that received the protocol.
export function createWorkReports(ports: WorkPorts, record: RoomRecord, members: () => WorkMember[]): WorkReports {
  const claimed = new Map<string, { member: string; turn: string }>();
  const injecting = new Set<string>();
  // The record indexes of the owner lines that the owner sent during a relay.
  const followUps = new Set<number>();
  const inject = (): void => {
    let value: unknown;
    try {
      value = ports.sessions();
    } catch (error) {
      ports.report("room report", error instanceof Error ? error.message : String(error));
      return;
    }
    for (const member of members()) {
      const session = member.session;
      if (injecting.has(session)) continue;
      const from = record.sent()[session] ?? 0;
      if (![...followUps].some((index) => index >= from)) continue;
      let state;
      try {
        state = sessionProgram(value, session);
      } catch {
        // A session that core.sessions no longer lists has left the delivery.
        continue;
      }
      // An idle session receives the lines with its next line, and a blocked session waits for the event that ends the block.
      if (state !== "working") continue;
      injecting.add(session);
      ports.lines
        .submit(session, () => {
          const lines = record.pending(session, member.id);
          if (lines === null) {
            // Every unsent line is a line of its own member, which it gave, so nothing is left to send.
            record.markSent(session, record.lines.length);
            return null;
          }
          return { text: `${OWNER_INJECT_TEXT} | ${lines.text}`, accepted: () => record.markSent(session, lines.count) };
        })
        .then(
          () => true,
          (error: unknown) => {
            ports.report("room report", `member ${member.id}: ${error instanceof Error ? error.message : String(error)}`);
            return false;
          },
        )
        .then((submitted) => {
          injecting.delete(session);
          // A follow-up added while the line was built goes next; a refused submit waits for the next value of core.sessions.
          if (submitted) inject();
        });
    }
  };
  const releaseOf = (token: OpenToken, paths: string[]): void => {
    for (const path of paths) claimed.delete(path);
    record.append(token.member, `(release) ${paths.join(", ")}`);
  };
  return {
    reportCommand(params) {
      const token = ports.answers.turnOf(params);
      const text = (params as { text?: unknown }).text;
      if (typeof text !== "string" || text.trim() === "") throw new Error(`text must be a non-empty string, got ${JSON.stringify(text)}`);
      // The room sees no file write, so it checks the paths that a report names: each must lie in a claim of the reporter in this turn.
      const named = (params as { paths?: unknown }).paths === undefined ? [] : pathsOf(params);
      const covered = (path: string): boolean =>
        [...claimed].some(([held, owner]) => owner.turn === token.turn && (path === held || path.startsWith(`${held}/`)));
      const unclaimed = named.filter((path) => !covered(path));
      if (unclaimed.length > 0) throw new Error(`paths ${unclaimed.join(", ")} are not claimed by ${token.member}`);
      record.append(token.member, `(report) ${text}${named.length > 0 ? ` [${named.join(", ")}]` : ""}`);
      return { turn: token.turn };
    },
    claim(params) {
      const token = ports.answers.turnOf(params);
      const paths = pathsOf(params);
      for (const path of paths) {
        for (const [held, owner] of claimed) {
          if (owner.member !== token.member && overlaps(path, held)) throw new Error(`paths ${path} are claimed by ${owner.member}`);
        }
      }
      for (const path of paths) claimed.set(path, { member: token.member, turn: token.turn });
      record.append(token.member, `(claim) ${paths.join(", ")}`);
      return { turn: token.turn, paths };
    },
    release(params) {
      const token = ports.answers.turnOf(params);
      const paths = pathsOf(params);
      for (const path of paths) {
        if (claimed.get(path)?.member !== token.member) throw new Error(`path ${path} is not claimed by ${token.member}`);
      }
      releaseOf(token, paths);
      return { turn: token.turn, paths };
    },
    closed(token) {
      const paths = [...claimed].filter(([, owner]) => owner.turn === token.turn).map(([path]) => path);
      if (paths.length > 0) releaseOf(token, paths);
    },
    followUp() {
      followUps.add(record.lines.length - 1);
      inject();
    },
    inject,
    claims: () => [...claimed].map(([path, owner]) => ({ path, member: owner.member })),
  };
}
