// The tab title of a room (C119, docs/spec/room.md#header): the names of its checked members in roster order, or the plugin name
// while no member is checked. tab.title takes 1 to 256 characters without control characters (core docs/spec/plugins.md), so the
// names lose their control characters and a longer title ends with an ellipsis at 256 characters.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const LIMIT = 256;

export function roomTitle(names: readonly string[], pluginName: string): string {
  const shown = names.map((name) => name.replace(CONTROL, "")).filter((name) => name.length > 0);
  const title = shown.length === 0 ? pluginName : shown.join(" · ");
  const characters = [...title];
  return characters.length <= LIMIT ? title : `${characters.slice(0, LIMIT - 1).join("")}…`;
}
