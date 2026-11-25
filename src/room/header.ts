// The header of the room (docs/spec/room.md#header): the first line holds the plugin name on the left and the group select on the
// right; the member cards stand below in a grid of equal columns that uses the whole width, and a grid of three rows or more folds
// to its first two rows. The status bar, which the page puts directly above the composer, holds the transport status.

// The smallest width of a member card and the gap between the cards, in points.
const CARD_MIN = 150;
const GAP = 5;
// The rows that a folded grid keeps, and the rows from which the grid can fold.
const FOLDED_ROWS = 2;
const FOLD_ROWS = 3;

export const HEADER_CSS = `
.st-bar{display:flex;flex-direction:column;gap:4px;box-sizing:border-box;padding:3px var(--toolbar-pad-x,8px);border-bottom:1px solid rgba(127,127,127,.2);flex:0 0 auto;min-width:0}
.st-top{display:flex;align-items:center;gap:8px;min-height:var(--toolbar-h,28px);min-width:0}
.st-top b{font-weight:700;letter-spacing:.02em;flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.st-actions{margin-left:auto;display:flex;align-items:center;gap:6px;flex:0 0 auto}
.st-group{font:inherit;font-size:11px;max-width:180px;color:inherit;background:transparent;border:1px solid rgba(127,127,127,.28);border-radius:6px;padding:1px 4px}
.st-grid{display:grid;grid-template-columns:repeat(var(--cols),minmax(0,1fr));grid-auto-rows:1fr;gap:${GAP}px;min-width:0}
.st-grid:empty{display:none}
.st-grid>[hidden]{display:none!important}
.st-fold{align-self:flex-end;appearance:none;border:0;background:transparent;color:var(--fg3,#888);font:inherit;font-size:11px;padding:0 2px;cursor:pointer;white-space:nowrap}
.st-statusbar{display:flex;align-items:center;gap:8px;padding:3px var(--toolbar-pad-x,8px);min-width:0;flex:0 0 auto}
.st-status{margin-left:auto;font-size:11px;color:var(--fg3,#888);flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`;

// The columns of the member grid in a width: as many as cards of CARD_MIN points fit with their gaps, and at least one.
export function gridColumns(width: number): number {
  if (!Number.isFinite(width) || width < 0) throw new Error(`the member grid width must be a number of 0 or more, got ${width}`);
  return Math.max(1, Math.floor((width + GAP) / (CARD_MIN + GAP)));
}

// The rows of the member grid for a number of cards in a number of columns.
export function gridRows(cards: number, columns: number): number {
  return Math.ceil(cards / columns);
}

export interface RoomHeader {
  bar: HTMLElement;
  top: HTMLElement;
  // The right end of the first line, which holds the group select (C140).
  actions: HTMLElement;
  group: HTMLSelectElement;
  grid: HTMLElement;
  fold: HTMLButtonElement;
  // The line above the composer, which holds the transport status.
  statusBar: HTMLElement;
  status: HTMLElement;
  // Shows the transport status.
  setStatus(text: string): void;
  // Lays out the member cards of the grid for its width: the columns, the fold button and, while folded, the cards of the first two rows.
  layout(width: number, folded: boolean): void;
}

export function createRoomHeader(name: string, status: string, labels: { fold: string; unfold: string }): RoomHeader {
  const bar = part("div", "st-bar");
  const top = part("div", "st-top");
  const title = part("b", "");
  title.textContent = name;
  const actions = part("div", "st-actions");
  const group = part("select", "st-group") as HTMLSelectElement;
  actions.append(group);
  top.append(title, actions);
  const grid = part("div", "st-grid");
  const fold = part("button", "st-fold") as HTMLButtonElement;
  fold.type = "button";
  fold.hidden = true;
  bar.append(top, grid, fold);
  const statusBar = part("div", "st-statusbar");
  const statusEl = part("span", "st-status");
  statusBar.append(statusEl);
  const setStatus = (text: string): void => {
    statusEl.textContent = text;
    statusEl.title = text;
  };
  setStatus(status);
  const layout = (width: number, folded: boolean): void => {
    const columns = gridColumns(width);
    grid.style.setProperty("--cols", String(columns));
    const cards = [...grid.children] as HTMLElement[];
    const foldable = gridRows(cards.length, columns) >= FOLD_ROWS;
    fold.hidden = !foldable;
    fold.textContent = folded ? labels.unfold : labels.fold;
    for (const [index, card] of cards.entries()) card.hidden = foldable && folded && index >= FOLDED_ROWS * columns;
  };
  return { bar, top, actions, group, grid, fold, statusBar, status: statusEl, setStatus, layout };
}

function part(tag: string, cls: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  return node;
}

// Fills the group select with the groups of the agents plugin in identifier order, each by its name, after the placeholder option, which
// is selected while the room has no assigned group and cannot be chosen (docs/spec/room.md#header).
export function fillGroupSelect(select: HTMLSelectElement, groups: Readonly<Record<string, { name: string }>>, assigned: string | null, placeholder: string): void {
  const first = document.createElement("option");
  first.value = "";
  first.textContent = placeholder;
  first.disabled = true;
  const options = Object.keys(groups).sort().map((id) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = groups[id].name;
    return option;
  });
  select.replaceChildren(first, ...options);
  select.value = assigned !== null && assigned in groups ? assigned : "";
}
