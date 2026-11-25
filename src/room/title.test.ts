import { describe, expect, it } from "vitest";
import { roomTitle } from "./title";

// C149: the tab of a room is the room itself: the plugin name and the name of its assigned group, so two rooms are told apart, and the
// plugin name without a group; core shows its default title only when the room reports none (docs/spec/room.md#header).
describe("roomTitle", () => {
  it("is the plugin name and the name of the assigned group", () => {
    expect(roomTitle("game team", "에이전트 클럽하우스")).toBe("에이전트 클럽하우스 · game team");
  });

  it("is the plugin name without an assigned group", () => {
    expect(roomTitle(null, "에이전트 클럽하우스")).toBe("에이전트 클럽하우스");
  });

  it("ends a title longer than 256 characters with an ellipsis at 256 characters", () => {
    const title = roomTitle("g".repeat(300), "room");
    expect([...title].length).toBe(256);
    expect(title.endsWith("…")).toBe(true);
  });

  it("removes control characters from the group name", () => {
    expect(roomTitle("a\u0007b\nc", "room")).toBe("room · abc");
  });
});
