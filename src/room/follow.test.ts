// The follow mode of the conversation view (docs/spec/room.md#follow-mode): the view follows new entries only while it is at the bottom;
// in reading mode the scroll stays, and the unseen count holds the entries below the viewport that have not been visible yet.
import { describe, expect, it } from "vitest";
import { createFollow, type FollowState } from "./follow";

function view() {
  let bottom = true;
  let scrolls = 0;
  const states: FollowState[] = [];
  const follow = createFollow({ atBottom: () => bottom, scrollToBottom: () => void (scrolls += 1), changed: (state) => void states.push(state) });
  return { follow, states, scrolls: () => scrolls, setBottom: (value: boolean) => void (bottom = value) };
}

describe("createFollow", () => {
  it("follows a new entry while the view is at the bottom", () => {
    const v = view();
    v.follow.added([0]);
    expect(v.scrolls()).toBe(1);
    expect(v.follow.state()).toEqual({ following: true, unseen: 0 });
  });

  it("keeps the scroll in reading mode and raises unseen with each new entry", () => {
    const v = view();
    v.setBottom(false);
    v.follow.scrolled();
    v.follow.added([3, 4, 5]);
    expect(v.scrolls()).toBe(0);
    expect(v.follow.state()).toEqual({ following: false, unseen: 3 });
    expect(v.states.at(-1)).toEqual({ following: false, unseen: 3 });
  });

  it("lowers unseen as the entries become visible, and counts an entry once", () => {
    const v = view();
    v.setBottom(false);
    v.follow.scrolled();
    v.follow.added([3, 4, 5]);
    v.follow.visible(3);
    v.follow.visible(3);
    expect(v.follow.state().unseen).toBe(2);
  });

  it("clears unseen and follows again when the view reaches the bottom", () => {
    const v = view();
    v.setBottom(false);
    v.follow.scrolled();
    v.follow.added([3, 4]);
    v.setBottom(true);
    v.follow.scrolled();
    expect(v.follow.state()).toEqual({ following: true, unseen: 0 });
    v.follow.added([5]);
    expect(v.scrolls()).toBe(1);
  });

  it("the pill command scrolls to the bottom and follows", () => {
    const v = view();
    v.setBottom(false);
    v.follow.scrolled();
    v.follow.added([3]);
    expect(v.follow.bottom()).toEqual({ following: true, unseen: 0 });
    expect(v.scrolls()).toBe(1);
  });
});
