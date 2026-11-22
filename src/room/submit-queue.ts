// The submit queue of the room (docs/spec/room.md#work-reports): one queue per member session, so the next submit of a session is sent
// only after core answered the previous one. Each line is built when it reaches the head of its queue, from the sent number that the
// previous accepted submit left, and `accepted` raises the sent number after core accepted it, so the lines of a session never overlap.
import { sessionSubmit, type SessionCommandPort } from "./session-channel";

export interface QueuedLine {
  text: string;
  // Runs after core accepted the submit.
  accepted(): void;
}

export interface SubmitQueue {
  // Builds the line at the head of the queue of the session and submits it; resolves false when `build` gave no line, and rejects with
  // the refusal of core or of the build.
  submit(session: string, build: () => QueuedLine | null): Promise<boolean>;
}

export function createSubmitQueue(port: SessionCommandPort): SubmitQueue {
  const tails = new Map<string, Promise<unknown>>();
  return {
    submit(session, build) {
      const run = (tails.get(session) ?? Promise.resolve()).then(async () => {
        const line = build();
        if (line === null) return false;
        await sessionSubmit(port, session)(line.text);
        line.accepted();
        return true;
      });
      tails.set(session, run.catch(() => undefined));
      return run;
    },
  };
}
