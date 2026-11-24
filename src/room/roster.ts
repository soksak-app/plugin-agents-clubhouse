// The roster of the room (C3, C34): one entry per agent definition of the agents data. The order of an earlier roster stays, a
// removed definition leaves it, and a new definition joins it as no member, because inviting a member is the choice of the person.
// A checked entry is a member that receives the next message (docs/spec/room.md#roster).
import type { AgentDefinition } from "./definitions";

export interface RosterEntry {
  id: string;
  name: string;
  // Whether the person invited the entry into the room; only a member has a session and is checked.
  member: boolean;
  checked: boolean;
  // The role of the member in the room, "" without one (docs/spec/room.md#roles).
  role: string;
  // Whether the member is the leader of the room, at most one entry (docs/spec/room.md#leader).
  leader: boolean;
}

export function rosterFrom(definitions: AgentDefinition[], previous: RosterEntry[]): RosterEntry[] {
  const ids = definitions.map((definition) => definition.id);
  if (new Set(ids).size !== ids.length) throw new Error(`agent definition identifiers must be unique: ${ids.join(", ")}`);
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const kept = previous
    .filter((entry) => byId.has(entry.id))
    .map((entry) => ({ id: entry.id, name: byId.get(entry.id)!.name, member: entry.member, checked: entry.checked, role: entry.role, leader: entry.leader }));
  const known = new Set(kept.map((entry) => entry.id));
  const added = definitions
    .filter((definition) => !known.has(definition.id))
    .map((definition) => ({ id: definition.id, name: definition.name, member: false, checked: false, role: "", leader: false }));
  return [...kept, ...added];
}

// The members of a room tab without a state (docs/spec/room.md#restart): a definition whose stored session is one of the owned open
// sessions of the room is a checked member, so the room reattaches to it; every other definition is no member. The names come from rosterFrom.
export async function reattachedChecks(
  definitions: AgentDefinition[],
  storedSession: (id: string) => Promise<string | null>,
  owned: ReadonlySet<string>,
): Promise<RosterEntry[]> {
  const entries: RosterEntry[] = [];
  for (const definition of definitions) {
    const session = await storedSession(definition.id);
    const present = session !== null && owned.has(session);
    entries.push({ id: definition.id, name: "", member: present, checked: present, role: "", leader: false });
  }
  return entries;
}
