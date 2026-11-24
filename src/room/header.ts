// The header of the room (docs/spec/room.md#header): the plugin name, the roster tabs, the mode buttons and the transport status
// in one row, which wraps in a narrow card.

export const HEADER_CSS = `
.st-bar{display:flex;align-items:center;gap:4px 8px;height:auto;min-height:var(--toolbar-h,28px);box-sizing:border-box;padding:3px var(--toolbar-pad-x,8px);border-bottom:1px solid rgba(127,127,127,.2);flex:0 0 auto;flex-wrap:wrap;min-width:0}
.st-bar b{font-weight:700;letter-spacing:.02em;flex:0 0 auto;white-space:nowrap}
.st-tabs{display:flex;align-items:center;gap:5px;flex-wrap:nowrap;flex:1 1 160px;min-width:120px;overflow-x:auto;scrollbar-width:none}
.st-tabs::-webkit-scrollbar{display:none}
.st-kib{margin-left:4px;display:inline-flex;border-radius:8px;overflow:hidden;border:1px solid rgba(127,127,127,.28);flex:0 0 auto}
.st-kib button{appearance:none;border:0;background:transparent;color:inherit;opacity:.6;font:inherit;font-size:11px;padding:3px 9px;cursor:pointer;white-space:nowrap}
.st-kib button.on{opacity:1;background:rgba(127,127,127,.2);font-weight:700}
.st-status{margin-left:auto;font-size:11px;color:var(--fg3,#888);flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`;

export interface RoomHeader {
  bar: HTMLElement;
  tabs: HTMLElement;
  kib: HTMLElement;
  status: HTMLElement;
  // Shows the transport status.
  setStatus(text: string): void;
}

export function createRoomHeader(name: string, status: string): RoomHeader {
  const bar = part("div", "st-bar");
  const title = part("b", "");
  title.textContent = name;
  const tabs = part("div", "st-tabs");
  const kib = part("div", "st-kib");
  const statusEl = part("span", "st-status");
  bar.append(title, tabs, kib, statusEl);
  const setStatus = (text: string): void => {
    statusEl.textContent = text;
    statusEl.title = text;
  };
  setStatus(status);
  return { bar, tabs, kib, status: statusEl, setStatus };
}

function part(tag: string, cls: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  return node;
}
