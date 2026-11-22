// The work reports and the path claims of the members (docs/spec/room.md#work-reports). A member reports, claims and releases with the
// token of its open turn, which proves the member, and the turn goes on. Each report, claim and release is a record line of the member,
// `(report) <text>`, `(claim) <paths>` or `(release) <paths>`. The room injects the lines that a working session has not been sent at
// once, without a token, so the member reads them during its work; an idle session receives them with its next turn line or its closing
// delivery, and a blocked session when the event of core.sessions shows it working again. The room decides each claim at once in the
// handler, which runs to its end before another handler, so two overlapping claims never both succeed. The claims of a turn are released
// when the turn closes.
import { sessionProgram } from "./session-channel";
import type { AnswerChannel, OpenToken } from "./answer";
import type { RoomRecord } from "./room-record";
import type { SubmitQueue } from "./submit-queue";

export const REPORT_COMMAND = "soksak-plugin-agents-clubhouse.report";
export const CLAIM_COMMAND = "soksak-plugin-agents-clubhouse.claim";
export const RELEASE_COMMAND = "soksak-plugin-agents-clubhouse.release";

// The preface of an injected line: the member reads it and goes on with its work.
export const INJECT_TEXT = "답하지 말고 하던 작업을 계속해.";

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
  // Injects the unsent lines into each working session; the room calls it after each work line and at each value of core.sessions.
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
      if ((record.sent()[session] ?? 0) >= record.lines.length) continue;
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
          return { text: `${INJECT_TEXT} | ${lines.text}`, accepted: () => record.markSent(session, lines.count) };
        })
        .catch((error: unknown) => ports.report("room report", `member ${member.id}: ${error instanceof Error ? error.message : String(error)}`))
        .finally(() => {
          injecting.delete(session);
          if ((record.sent()[session] ?? 0) < record.lines.length) inject();
        });
    }
  };
  const releaseOf = (token: OpenToken, paths: string[]): void => {
    for (const path of paths) claimed.delete(path);
    record.append(token.member, `(release) ${paths.join(", ")}`);
    inject();
  };
  return {
    reportCommand(params) {
      const token = ports.answers.turnOf(params);
      const text = (params as { text?: unknown }).text;
      if (typeof text !== "string" || text.trim() === "") throw new Error(`text must be a non-empty string, got ${JSON.stringify(text)}`);
      record.append(token.member, `(report) ${text}`);
      inject();
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
      inject();
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
      if (token.kind !== "answer") return;
      const paths = [...claimed].filter(([, owner]) => owner.turn === token.turn).map(([path]) => path);
      if (paths.length > 0) releaseOf(token, paths);
    },
    inject,
    claims: () => [...claimed].map(([path, owner]) => ({ path, member: owner.member })),
  };
}
