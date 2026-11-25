// The tab title of a room (C149, docs/spec/room.md#header): the plugin name and the name of the assigned group, or the plugin name without
// a group. tab.title takes 1 to 256 characters without control characters (core docs/spec/plugins.md), so the group name loses its
// control characters and a longer title ends with an ellipsis at 256 characters.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const LIMIT = 256;

export function roomTitle(groupName: string | null, pluginName: string): string {
  const shown = groupName?.replace(CONTROL, "") ?? "";
  const title = shown.length === 0 ? pluginName : `${pluginName} · ${shown}`;
  const characters = [...title];
  return characters.length <= LIMIT ? title : `${characters.slice(0, LIMIT - 1).join("")}…`;
}
