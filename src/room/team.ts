// The team of the leader (docs/spec/room.md#team). The leader summons each member with member.summon; the command checks only its
// input, because the leader owns the work and the folders, and the terminal refuses a directory that does not exist. A team member
// has the summon id `<definition>-<n>`, `<n>` being the smallest positive integer that no team member of the definition uses.

export interface TeamEntry {
  id: string;
  definition: string;
  role: string;
  directory: string;
}

export interface SummonCheck {
  team: readonly TeamEntry[];
  definitions: readonly { id: string; name: string }[];
  // The leader and the tokens of its open turns; null without a leader.
  leader: { id: string; turns: string[] } | null;
  maxMembers: number;
}

const MAX_MEMBERS = 16;

// Reads the plugin setting maxMembers, an integer from 1 to 16, and refuses any other value.
export function maxMembersOf(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_MEMBERS) {
    throw new Error(`settings.maxMembers must be an integer from 1 to ${MAX_MEMBERS}, got ${JSON.stringify(value)}`);
  }
  return value as number;
}

// The role text of the roles rule (docs/spec/room.md#roles).
export function roleOf(role: unknown): string {
  if (typeof role !== "string" || [...role].length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(role)) {
    throw new Error(`role must be a text of 0 to 200 characters without control characters, got ${JSON.stringify(role)}`);
  }
  return role.trim();
}

// The team entry of a summon, or the refusal of its input.
export function summonedEntry(params: any, check: SummonCheck): TeamEntry {
  if (check.leader === null) throw new Error("member.summon needs a leader: set one with member.leader");
  const turn = params?.turn;
  if (typeof turn !== "string" || !check.leader.turns.includes(turn)) {
    throw new Error(`member.summon takes the turn token of the leader ${check.leader.id}, got ${typeof turn === "string" ? turn : JSON.stringify(turn)}`);
  }
  const definition = params?.definition;
  if (typeof definition !== "string" || !check.definitions.some((entry) => entry.id === definition)) {
    throw new Error(`definition ${typeof definition === "string" ? definition : JSON.stringify(definition)} is not an agent definition`);
  }
  const role = roleOf(params?.role);
  const directory = params?.directory;
  if (typeof directory !== "string" || !directory.startsWith("/") || /[\u0000-\u001f]/.test(directory)) {
    throw new Error(`directory must be an absolute path, got ${JSON.stringify(directory)}`);
  }
  if (check.team.length >= check.maxMembers) throw new Error(`the team has reached maxMembers ${check.maxMembers}`);
  const used = new Set(check.team.filter((entry) => entry.definition === definition).map((entry) => entry.id));
  let n = 1;
  while (used.has(`${definition}-${n}`)) n += 1;
  return { id: `${definition}-${n}`, definition, role, directory };
}

// The name of a team member: the name of its definition and its number, by which a mention names it.
export function teamName(entry: TeamEntry, definitions: readonly { id: string; name: string }[]): string {
  const name = definitions.find((definition) => definition.id === entry.definition)?.name ?? entry.definition;
  return `${name}${entry.id.slice(entry.definition.length)}`;
}
