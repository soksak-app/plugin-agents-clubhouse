// The roster of the room (C3, C34): one entry per agent definition of the agents data. The order of an earlier roster stays, a
// removed definition leaves it, and a new definition joins it unchecked, because inviting a member is the choice of the person.
import type { AgentDefinition } from "./definitions";

export interface RosterEntry {
  id: string;
  name: string;
  checked: boolean;
}

export function rosterFrom(definitions: AgentDefinition[], previous: RosterEntry[]): RosterEntry[] {
  const ids = definitions.map((definition) => definition.id);
  if (new Set(ids).size !== ids.length) throw new Error(`agent definition identifiers must be unique: ${ids.join(", ")}`);
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const kept = previous
    .filter((entry) => byId.has(entry.id))
    .map((entry) => ({ id: entry.id, name: byId.get(entry.id)!.name, checked: entry.checked }));
  const known = new Set(kept.map((entry) => entry.id));
  const added = definitions
    .filter((definition) => !known.has(definition.id))
    .map((definition) => ({ id: definition.id, name: definition.name, checked: false }));
  return [...kept, ...added];
}

// The checks of a room tab without a state (docs/spec/room.md#restart): a definition whose stored session is one of the owned open
// sessions of the room is checked, so the room reattaches to it; every other definition is unchecked. The names come from rosterFrom.
export async function reattachedChecks(
  definitions: AgentDefinition[],
  storedSession: (id: string) => Promise<string | null>,
  owned: ReadonlySet<string>,
): Promise<RosterEntry[]> {
  const entries: RosterEntry[] = [];
  for (const definition of definitions) {
    const session = await storedSession(definition.id);
    entries.push({ id: definition.id, name: "", checked: session !== null && owned.has(session) });
  }
  return entries;
}
