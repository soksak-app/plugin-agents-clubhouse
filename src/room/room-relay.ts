// The message relay of the room (C5) over the members' owned sessions. A room message goes to each member in the order of the list:
// the member's turn must end before the next member receives the message, so the answers come one after another. The answer of a member
// is the screen that core.session.read reports after its turn, which the room shows as text.
import { relayMemberMessage, type SessionRelayPort } from "./relay";
import { sessionProgram, sessionRead, sessionSubmit, type SessionCommandPort } from "./session-channel";

export interface RelayMember {
  id: string;
  // The owned session of the member (the summon relation of C3).
  session: string;
}

export interface MemberAnswer {
  id: string;
  rows: string[];
}

export interface RelayPorts extends SessionCommandPort {
  // The current value of core.sessions, the list of open sessions.
  sessions(): unknown;
  // Calls the listener with each new value of core.sessions; the returned function ends the watch.
  watchSessions(listener: (value: unknown) => void): () => void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Sends the text to each member in order and resolves with the screen of each member. A refusal, a turn that is blocked, or a session
// that leaves core.sessions rejects with the member identifier and the reason, and the members after it receive nothing.
export async function relayToMembers(ports: RelayPorts, members: RelayMember[], text: string): Promise<MemberAnswer[]> {
  const answers: MemberAnswer[] = [];
  for (const member of members) {
    const controller = new AbortController();
    // A value of core.sessions that the relay cannot read ends the turn with this error, so the relay never waits on a bad value.
    let failure: unknown = null;
    const port: SessionRelayPort = {
      submit: sessionSubmit(ports, member.session),
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
    try {
      await relayMemberMessage(port, text, { signal: controller.signal });
    } catch (error) {
      throw new Error(`member ${member.id}: ${messageOf(failure ?? error)}`);
    }
    const screen = await sessionRead(ports, member.session);
    answers.push({ id: member.id, rows: screen.rows });
  }
  return answers;
}
