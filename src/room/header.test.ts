// @vitest-environment jsdom
// The header of the room (C37, C138, C140, C149, docs/spec/room.md#header): the tab shows the plugin name, so the header has no line
// of it; the member cards stand in a grid of equal columns that uses the whole width, and a grid of three rows or more folds to its first two
// rows. The status bar above the composer holds the group select and the transport status, which shrinks with an ellipsis and shows its
// whole text as its tooltip. jsdom computes the cascade of the style sheet and lays out nothing, so the tests read the declared
// properties and pass the width of the grid.
import { beforeEach, describe, expect, it } from "vitest";
import { HEADER_CSS, createRoomHeader, fillGroupSelect, gridColumns, gridRows } from "./header";

const STATUS = "연결됨: 메시지는 열린 member session에 전달된다";
const LABELS = { fold: "접기", unfold: "펼치기" };

function header() {
  const h = createRoomHeader(STATUS, LABELS);
  document.body.append(h.bar, h.statusBar);
  return h;
}

function cards(h: ReturnType<typeof header>, count: number): HTMLElement[] {
  const all = Array.from({ length: count }, () => {
    const card = document.createElement("span");
    card.className = "st-tab";
    return card;
  });
  h.grid.replaceChildren(...all);
  return all;
}

beforeEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  const style = document.createElement("style");
  style.textContent = HEADER_CSS;
  document.head.append(style);
});

describe("grid of the member cards", () => {
  it("has as many equal columns as cards of 150 points fit in the width, and at least one", () => {
    expect(gridColumns(0)).toBe(1);
    expect(gridColumns(149)).toBe(1);
    expect(gridColumns(305)).toBe(2);
    expect(gridColumns(620)).toBe(4);
    expect(() => gridColumns(Number.NaN)).toThrow("the member grid width must be a number of 0 or more, got NaN");
    expect(gridRows(0, 3)).toBe(0);
    expect(gridRows(7, 3)).toBe(3);
  });

  it("uses the whole width with cards of one width and one height", () => {
    const h = header();
    cards(h, 3);
    h.layout(620, false);
    const grid = getComputedStyle(h.grid);
    expect(grid.display).toBe("grid");
    expect(h.grid.style.getPropertyValue("--cols")).toBe("4");
    expect(HEADER_CSS).toContain("grid-template-columns:repeat(var(--cols),minmax(0,1fr))");
    expect(HEADER_CSS).toContain("grid-auto-rows:1fr");
  });

  it("shows the fold button only while the grid has three rows or more, and folds to the first two rows", () => {
    const h = header();
    const all = cards(h, 5);
    h.layout(305, false);
    expect(h.fold.hidden).toBe(false);
    expect(h.fold.textContent).toBe("접기");
    expect(all.map((card) => card.hidden)).toEqual([false, false, false, false, false]);
    h.layout(305, true);
    expect(h.fold.textContent).toBe("펼치기");
    expect(all.map((card) => card.hidden)).toEqual([false, false, false, false, true]);
    h.layout(620, true);
    expect(h.fold.hidden).toBe(true);
    expect(all.map((card) => card.hidden)).toEqual([false, false, false, false, false]);
  });
});

describe("first line and status bar", () => {
  it("has no line of the plugin name, because the tab shows it, and puts the group select at the left of the status bar (C149)", () => {
    const h = header();
    expect([...h.bar.children]).toEqual([h.grid, h.fold]);
    expect(h.bar.textContent).not.toContain("에이전트 클럽하우스");
    expect(h.statusBar.firstElementChild).toBe(h.group);
    expect(h.group.tagName).toBe("SELECT");
  });

  it("lists the groups by identifier with their names, selects the assigned group and shows the placeholder without one (C140)", () => {
    const h = header();
    const groups = { g2: { name: "Two", members: [], leader: null }, g1: { name: "One", members: ["a"], leader: "a" } };
    fillGroupSelect(h.group, groups, null, "그룹 선택");
    expect([...h.group.options].map((option) => [option.value, option.textContent, option.disabled])).toEqual([["", "그룹 선택", true], ["g1", "One", false], ["g2", "Two", false]]);
    expect(h.group.value).toBe("");
    fillGroupSelect(h.group, groups, "g2", "그룹 선택");
    expect(h.group.value).toBe("g2");
  });

  it("holds the group select and the transport status in the status bar, because the room has no conversation mode (C141, C149)", () => {
    const h = header();
    expect([...h.statusBar.children]).toEqual([h.group, h.status]);
  });

  it("shrinks the transport status with an ellipsis and shows its whole text as its tooltip", () => {
    const h = header();
    const status = getComputedStyle(h.status);
    expect(status.flexShrink).toBe("1");
    expect(status.minWidth).toBe("0px");
    expect(status.overflow).toBe("hidden");
    expect(status.textOverflow).toBe("ellipsis");
    expect(status.whiteSpace).toBe("nowrap");
    expect(h.status.title).toBe(STATUS);
    h.setStatus("연결 안 됨");
    expect(h.status.textContent).toBe("연결 안 됨");
    expect(h.status.title).toBe("연결 안 됨");
  });
});
