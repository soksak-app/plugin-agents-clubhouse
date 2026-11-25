// The members of the room (docs/spec/room.md#group): the members of the group of the agents plugin that the room is assigned, in the
// order of the group, with the leader that the agents plugin stores for the group (agents docs/spec/definitions.md#leader).
import type { AgentDefinition } from "./definitions";

export interface RoomMember {
  id: string;
  name: string;
  // Whether the member is the leader of the group (docs/spec/room.md#leader).
  leader: boolean;
}

export interface AgentGroup {
  name: string;
  members: string[];
  leader: string | null;
}

const WHERE = "agents project data groups";
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string" && value !== "";

// Reads the groups of the agents plugin; an absent value reads as no groups. A value of another form is refused with the group and
// what it found, with the leader rules of the agents plugin.
export function readGroups(value: unknown): Record<string, AgentGroup> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error(`${WHERE}: the value is not an object of group identifier to {name, members, leader}`);
  const groups: Record<string, AgentGroup> = {};
  for (const [id, group] of Object.entries(value)) {
    const keys = isRecord(group) ? Object.keys(group).sort().join(",") : "";
    if (
      !isRecord(group) || keys !== "leader,members,name" || typeof group.name !== "string" ||
      !Array.isArray(group.members) || !group.members.every(isText) || !(group.leader === null || isText(group.leader))
    ) {
      throw new Error(`${WHERE}: group ${id} must be {name, members, leader}, got ${JSON.stringify(group)}`);
    }
    const members = group.members as string[];
    const leader = group.leader as string | null;
    if (members.length > 0 && leader === null) throw new Error(`${WHERE}: group ${id} has members and no leader`);
    if (leader !== null && !members.includes(leader)) throw new Error(`${WHERE}: group ${id} has the leader ${leader}, which is not a member`);
    groups[id] = { name: group.name, members: [...members], leader };
  }
  return groups;
}

// The members of the assigned group in the order of the group. A group member without a stored definition is left out and reported;
// a room without a group, or with a group that the agents plugin no longer stores, has no members.
export function groupMembers(
  definitions: readonly AgentDefinition[],
  groups: Record<string, AgentGroup>,
  group: string | null,
  report: (text: string) => void,
): RoomMember[] {
  const stored = group === null ? undefined : groups[group];
  if (stored === undefined) return [];
  const members: RoomMember[] = [];
  for (const id of stored.members) {
    const definition = definitions.find((one) => one.id === id);
    if (definition === undefined) {
      report(`group ${group} member ${id} has no definition`);
      continue;
    }
    members.push({ id, name: definition.name, leader: stored.leader === id });
  }
  return members;
}
