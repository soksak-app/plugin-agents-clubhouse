// @vitest-environment jsdom
// The header of the room lays out in a narrow card (C37, docs/spec/room.md#header): the row wraps, the roster keeps a visible
// width, the buttons keep one line, and the transport status shrinks with an ellipsis and shows its whole text as its tooltip.
// jsdom computes the cascade of the style sheet and lays out nothing, so the tests read the declared properties.
import { beforeEach, describe, expect, it } from "vitest";
import { HEADER_CSS, createRoomHeader } from "./header";

const STATUS = "연결됨: 메시지는 열린 member session에 전달된다";

function header() {
  const h = createRoomHeader("에이전트 클럽하우스", "AI 명령", STATUS);
  const button = document.createElement("button");
  button.textContent = "진행";
  h.kib.append(button);
  document.body.append(h.bar);
  return { ...h, mode: button };
}

beforeEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  const style = document.createElement("style");
  style.textContent = HEADER_CSS;
  document.head.append(style);
});

describe("room header", () => {
  it("wraps its row and lets the row grow", () => {
    const bar = getComputedStyle(header().bar);
    expect(bar.flexWrap).toBe("wrap");
    expect(bar.height).toBe("auto");
  });

  it("keeps a visible width for the roster tabs", () => {
    const tabs = getComputedStyle(header().tabs);
    expect(tabs.minWidth).toBe("120px");
  });

  it("keeps each button on one line", () => {
    const h = header();
    expect(getComputedStyle(h.tower).whiteSpace).toBe("nowrap");
    expect(getComputedStyle(h.tower).flexShrink).toBe("0");
    expect(getComputedStyle(h.mode).whiteSpace).toBe("nowrap");
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
