// The definitions that the leader can summon (docs/spec/room.md#team). The list comes from the source of the roster, the agents
// definitions, so each id is a definition that member.summon takes; the groups come from the agents data `groups`, and the file is the
// first file of the role of the definition in core.roles, because the role identifier of a definition equals its identifier. The room
// reads no agent file: the leader reads each file with its own tools.

export interface SummonableDefinition {
  id: string;
  name: string;
  plugin: string;
  // The names of the groups of the agents data that hold the definition, in group identifier order.
  groups: string[];
  // The agent file of its role, null when core.roles lists no file for it.
  file: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export function summonableDefinitions(
  definitions: readonly { id: string; name: string; plugin: string }[],
  groups: unknown,
  roles: unknown,
): SummonableDefinition[] {
  const stored = groups ?? {};
  if (!isRecord(stored) || !Object.values(stored).every((group) => isRecord(group) && typeof group.name === "string" && Array.isArray(group.members))) {
    throw new Error("agents project data groups: the value is not an object of group identifier to {name, members}");
  }
  const list = isRecord(roles) ? roles.roles : undefined;
  if (!Array.isArray(list) || !list.every((role) => isRecord(role) && typeof role.id === "string" && Array.isArray(role.files))) {
    throw new Error("core.roles: the value is not {seq, roles: [{id, text, ko, files}]}");
  }
  const byGroup = Object.keys(stored).sort().map((id) => stored[id] as { name: string; members: unknown[] });
  return definitions.map((definition) => {
    const role = (list as { id: string; files: unknown[] }[]).find((entry) => entry.id === definition.id);
    const file = role?.files[0];
    return {
      id: definition.id,
      name: definition.name,
      plugin: definition.plugin,
      groups: byGroup.filter((group) => group.members.includes(definition.id)).map((group) => group.name),
      file: typeof file === "string" ? file : null,
    };
  });
}
