// The conversation resume of a member (docs/spec/room.md#conversation-resume): a member session that opens again continues the
// conversation of its CLI when the same account home and folder start it. Claude Code takes the identifier that the room sets with
// --session-id and continues it with --resume; Codex sets no identifier, so it continues the most recent conversation of the folder with
// `resume --last`, which only the own worktree of a member keeps apart from the conversations of other members.

// The recorded conversation of a member: the home of its account or null, the folder it starts in, and the identifier or null.
export interface ConversationRecord {
  home: string | null;
  folder: string;
  id: string | null;
}

export interface MemberStart {
  program: string;
  home: string | null;
  folder: string;
  // Whether the folder is the own worktree of the member, which no other member starts in.
  ownWorktree: boolean;
}

// The arguments that the start of the member adds after its other arguments, the record that the room keeps for it (null to remove it),
// and the conversation that the start resumes, null for a new one, which the report of a failed resume names.
export function resumeStart(
  start: MemberStart,
  record: ConversationRecord | undefined,
  newId: string,
): { args: string[]; record: ConversationRecord | null; resuming: string | null } {
  const name = start.program.split("/").at(-1) ?? start.program;
  const same = record !== undefined && record.home === start.home && record.folder === start.folder;
  if (name === "claude") {
    if (same && record.id !== null) return { args: ["--resume", record.id], record: { ...record }, resuming: `the conversation ${record.id}` };
    return { args: ["--session-id", newId], record: { home: start.home, folder: start.folder, id: newId }, resuming: null };
  }
  if (name === "codex" && start.ownWorktree) {
    const next = { home: start.home, folder: start.folder, id: null };
    return same ? { args: ["resume", "--last"], record: next, resuming: `the last conversation of ${start.folder}` } : { args: [], record: next, resuming: null };
  }
  return { args: [], record: null, resuming: null };
}

// The text of the error of a resume whose session ended before its protocol turn, or null when the start resumed nothing or its protocol
// turn ended otherwise; the room then removes the record, so the next open starts a new conversation.
export function failedResume(
  member: string,
  conversation: string | undefined,
  outcome: { ok: true } | { ok: false; reason: string; stopped?: true },
): string | null {
  if (conversation === undefined || outcome.ok || outcome.stopped === true || !outcome.reason.endsWith("ended before its protocol turn")) return null;
  return `member ${member}: the session ended while it resumed ${conversation}; the next open starts a new conversation`;
}
