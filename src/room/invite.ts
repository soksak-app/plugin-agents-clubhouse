// The invite dialog of the room (C120, docs/spec/room.md#invite): the params that the room opens it with, their reader in the dialog page,
// the rows of the definitions tree and the identifiers that a pick invites.

const P = "soksak-plugin-agents-clubhouse";
// The commands and elements of plugin.json that the invite dialog page serves; the room page registers every other declared entry.
export const INVITE_COMMANDS = { pick: `${P}.invite.pick`, cancel: `${P}.invite.cancel` } as const;
export const INVITE_ELEMENTS = { definition: `${P}.invite-dialog.definition`, pick: `${P}.invite-dialog.pick`, cancel: `${P}.invite-dialog.cancel` } as const;
export const INVITE_DIALOG_ENTRIES: ReadonlySet<string> = new Set([...Object.values(INVITE_COMMANDS), ...Object.values(INVITE_ELEMENTS)]);

export interface InviteParams {
  definitions: { id: string; name: string }[];
  groups: { id: string; name: string; members: string[] }[];
  members: string[];
}

export interface InviteGroup {
  // The group name, or null for the definitions in no group, which the page titles 그룹 없음.
  name: string | null;
  rows: { id: string; name: string; member: boolean }[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string" && value !== "";

// The params of the dialog: the roster entries in roster order, the agents data groups in group identifier order and the members.
export function inviteParams(roster: readonly { id: string; name: string; member: boolean }[], groups: unknown): InviteParams {
  const stored = groups ?? {};
  if (!isRecord(stored) || !Object.values(stored).every((group) => isRecord(group) && typeof group.name === "string" && Array.isArray(group.members) && group.members.every(isText))) {
    throw new Error("agents project data groups: the value is not an object of group identifier to {name, members}");
  }
  return {
    definitions: roster.map((entry) => ({ id: entry.id, name: entry.name })),
    groups: Object.keys(stored).sort().map((id) => {
      const group = stored[id] as { name: string; members: string[] };
      return { id, name: group.name, members: [...group.members] };
    }),
    members: roster.filter((entry) => entry.member).map((entry) => entry.id),
  };
}

// The reader of the params in the dialog page; another form is refused with the field and what it found.
export function parseInviteParams(value: unknown): InviteParams {
  if (!isRecord(value)) throw new Error(`invite params: the value must be {definitions, groups, members}, got ${JSON.stringify(value)}`);
  for (const field of Object.keys(value)) if (!["definitions", "groups", "members"].includes(field)) throw new Error(`invite params: unknown field ${field}`);
  const { definitions, groups, members } = value;
  if (!Array.isArray(definitions) || !definitions.every((one) => isRecord(one) && isText(one.id) && typeof one.name === "string")) {
    throw new Error(`invite params: definitions must be an array of {id, name}, got ${JSON.stringify(definitions)}`);
  }
  if (!Array.isArray(groups) || !groups.every((one) => isRecord(one) && isText(one.id) && typeof one.name === "string" && Array.isArray(one.members) && one.members.every(isText))) {
    throw new Error(`invite params: groups must be an array of {id, name, members}, got ${JSON.stringify(groups)}`);
  }
  if (!Array.isArray(members) || !members.every(isText)) throw new Error(`invite params: members must be an array of identifiers, got ${JSON.stringify(members)}`);
  return value as unknown as InviteParams;
}

// The tree of the dialog: each group with its definitions in its stored order, then the definitions in no group. A group member that
// names no definition is left out, and a group without a definition shows no rows.
export function inviteGroups(params: InviteParams): InviteGroup[] {
  const byId = new Map(params.definitions.map((one) => [one.id, one]));
  const members = new Set(params.members);
  const row = (id: string) => ({ id, name: byId.get(id)!.name, member: members.has(id) });
  const grouped = new Set(params.groups.flatMap((group) => group.members));
  const result: InviteGroup[] = params.groups.map((group) => ({ name: group.name, rows: group.members.filter((id) => byId.has(id)).map(row) }));
  const loose = params.definitions.filter((one) => !grouped.has(one.id)).map((one) => row(one.id));
  if (loose.length > 0) result.push({ name: null, rows: loose });
  return result;
}

// The identifiers that a pick invites: the picked definitions that are no member, in roster order.
export function invitedIds(params: InviteParams, picked: ReadonlySet<string>): string[] {
  const members = new Set(params.members);
  return params.definitions.map((one) => one.id).filter((id) => picked.has(id) && !members.has(id));
}
