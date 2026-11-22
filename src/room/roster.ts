// The roster of the room (C3): one entry per agent definition of the agents status. The order of an earlier roster stays, a removed
// definition leaves it, and a new definition joins it checked, because a person checks the members to summon them.
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
    .map((definition) => ({ id: definition.id, name: definition.name, checked: true }));
  return [...kept, ...added];
}
