import { describe, expect, it } from "vitest";
import { roomTitle } from "./title";

// C119: the tab of a room shows the names of its checked members, so two rooms are told apart, and the plugin name while no member
// is checked; core shows its default title only when the room reports none (docs/spec/room.md#header).
describe("roomTitle", () => {
  it("joins the names of the members in the order of the group", () => {
    expect(roomTitle(["claude-lead", "codex"], "에이전트 클럽하우스")).toBe("claude-lead · codex");
  });

  it("is the plugin name while no member is checked", () => {
    expect(roomTitle([], "에이전트 클럽하우스")).toBe("에이전트 클럽하우스");
  });

  it("ends a title longer than 256 characters with an ellipsis at 256 characters", () => {
    const title = roomTitle(Array.from({ length: 40 }, (_, i) => `member-${i}`), "room");
    expect([...title].length).toBe(256);
    expect(title.endsWith("…")).toBe(true);
  });

  it("removes control characters from the names", () => {
    expect(roomTitle(["a\u0007b", "c\nd"], "room")).toBe("ab · cd");
  });
});
