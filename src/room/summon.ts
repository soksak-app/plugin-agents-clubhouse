// Summoning (C3): starts each starting member as an owned session of the room surface (core docs/spec/plugins.md#owned-sessions).
// The room calls core.session.open {plugin, params, size} and stores the member-to-session relation in project data, so the
// relation survives a restart. A stored session is reused only while core.sessions lists it as open. The room holds no plugin
// identifier in its code: the member definitions, with the plugin that runs each member, come from the caller, which reads them
// from the agents definitions point.

import type { RoomPort } from "./port";
import type { MemberSessionStore } from "./session-store";

export interface MemberDefinition {
  id: string;
  // The name that the room shows for the member; it is the title of the member tab.
  name: string;
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
  // The identifiers of the sessions that core.sessions lists as open.
  openSessions: () => Promise<string[]>;
  // The sessions that a summon opened and that core.sessions has not listed yet.
  opened: OpenedSessions;
}

// The sessions that the room opened before core.sessions listed them (docs/spec/room.md#restart). A summon counts them as open, so a
// summon that runs before core.sessions lists a session opens no second session for its member.
export interface OpenedSessions {
  add(session: string): void;
  // Removes the sessions that a value of core.sessions lists.
  listed(sessions: Iterable<string>): void;
  unlisted(): string[];
}

export function createOpenedSessions(): OpenedSessions {
  const unlisted = new Set<string>();
  return {
    add: (session) => void unlisted.add(session),
    listed(sessions) {
      for (const session of sessions) unlisted.delete(session);
    },
    unlisted: () => [...unlisted],
  };
}

// The size of a session: the width and height of its card in points and the backing scale of the window
// (core docs/spec/plugins.md#owned-sessions).
export interface SessionSize {
  width: number;
  height: number;
  scale: number;
}

export interface SummonRequest {
  definitions: MemberDefinition[];
  // The identifiers of the members that start: the members of the room whose account can start them (docs/spec/room.md#login).
  starting: string[];
  // The measured card size; read only before the first session that opens, so a reattach needs no laid-out card.
  size: () => Promise<SessionSize>;
}

export interface SummonedMember {
  id: string;
  session: string;
  // false when a stored session was reused; no open call was made for that member.
  opened: boolean;
}

// Opens the sessions of the starting members in definition order. Each failure rejects with its text; the members opened before
// it keep their stored relation, and the refused member stores nothing.
export async function summonMembers(deps: SummonDeps, request: SummonRequest): Promise<SummonedMember[]> {
  let size: SessionSize | null = null;
  const measured = async (): Promise<SessionSize> => {
    if (size !== null) return size;
    const value = await request.size();
    if (![value.width, value.height, value.scale].every((one) => Number.isFinite(one) && one > 0)) {
      throw new Error("size width, height and scale must be positive numbers");
    }
    size = value;
    return value;
  };
  const ids = request.definitions.map((definition) => definition.id);
  if (new Set(ids).size !== ids.length) throw new Error("member definitions must have unique ids");

  const summoned: SummonedMember[] = [];
  const open = new Set([...(await deps.openSessions()), ...deps.opened.unlisted()]);
  for (const definition of request.definitions) {
    if (!request.starting.includes(definition.id)) continue;
    const stored = await deps.sessions.get(definition.id);
    if (stored && open.has(stored.sessionId)) {
      summoned.push({ id: definition.id, session: stored.sessionId, opened: false });
      continue;
    }
    const reply = await deps.room.commands.execute("core.session.open", {
      plugin: definition.plugin,
      params: definition.params,
      size: await measured(),
    });
    const session = (reply as { session?: unknown } | null | undefined)?.session;
    if (typeof session !== "string" || session === "") throw new Error("core.session.open reply has no session");
    deps.opened.add(session);
    try {
      await deps.sessions.put({ agentId: definition.id, sessionId: session, cwd: definition.cwd, savedAt: deps.now() });
    } catch (error) {
      // A session whose relation is not stored belongs to no member after a restart, so the room ends it.
      const reason = error instanceof Error ? error.message : String(error);
      try {
        await deps.room.commands.execute("core.session.end", { session });
      } catch (end) {
        throw new Error(`member ${definition.id}: the relation was not stored: ${reason}; core.session.end ${session} failed: ${end instanceof Error ? end.message : String(end)}`);
      }
      throw new Error(`member ${definition.id}: the relation was not stored: ${reason}; session ${session} ended`);
    }
    summoned.push({ id: definition.id, session, opened: true });
  }
  return summoned;
}
