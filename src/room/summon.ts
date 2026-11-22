// Summoning (C3): starts each checked member as an owned session of the room surface (core docs/spec/plugins.md#owned-sessions).
// The room calls core.session.open {plugin, params, cols, rows} and stores the member-to-session relation in project data, so the
// relation survives a restart. The room holds no plugin identifier in its code: the member definitions, with the plugin that
// runs each member, come from the caller, which reads them from the agents definitions point.
//
// Not built yet: the reattach check of a stored session through core.sessions (a stored session is reused without a check),
// the placement of the sessions on cards (C4), and the trigger that calls summonMembers.

import type { RoomPort } from "./port";
import type { MemberSessionStore } from "./session-store";

export interface MemberDefinition {
  id: string;
  // The plugin whose sessions open the member (core.session.open {plugin}). Refused by core while it declares no sessions.
  plugin: string;
  // Passed unchanged to the plugin's sidecar as the params of the session.
  params: Record<string, unknown>;
  // The project folder in which the member works; recorded with its session.
  cwd: string;
}

export interface SummonDeps {
  room: Pick<RoomPort, "commands">;
  sessions: MemberSessionStore;
  now: () => number;
}

export interface SummonRequest {
  definitions: MemberDefinition[];
  // The identifiers of the checked members of the roster.
  checked: string[];
  cols: number;
  rows: number;
}

export interface SummonedMember {
  id: string;
  session: string;
  // false when a stored session was reused; no open call was made for that member.
  opened: boolean;
}

// Opens the sessions of the checked members in definition order. Each failure rejects with its text; the members opened before
// it keep their stored relation, and the refused member stores nothing.
export async function summonMembers(deps: SummonDeps, request: SummonRequest): Promise<SummonedMember[]> {
  const { cols, rows } = request;
  if (!Number.isInteger(cols) || cols < 1 || !Number.isInteger(rows) || rows < 1) {
    throw new Error("summon size must be positive integers");
  }
  const ids = request.definitions.map((definition) => definition.id);
  if (new Set(ids).size !== ids.length) throw new Error("member definitions must have unique ids");

  const summoned: SummonedMember[] = [];
  for (const definition of request.definitions) {
    if (!request.checked.includes(definition.id)) continue;
    const stored = await deps.sessions.get(definition.id);
    if (stored) {
      summoned.push({ id: definition.id, session: stored.sessionId, opened: false });
      continue;
    }
    const reply = await deps.room.commands.execute("core.session.open", {
      plugin: definition.plugin,
      params: definition.params,
      cols,
      rows,
    });
    const session = (reply as { session?: unknown } | null | undefined)?.session;
    if (typeof session !== "string" || session === "") throw new Error("core.session.open reply has no session");
    await deps.sessions.put({ agentId: definition.id, sessionId: session, cwd: definition.cwd, savedAt: deps.now() });
    summoned.push({ id: definition.id, session, opened: true });
  }
  return summoned;
}
