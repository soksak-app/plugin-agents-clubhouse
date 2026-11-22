// The follow mode of the conversation view (docs/spec/room.md#follow-mode). The view follows new entries only while it is at the
// bottom. When the person scrolls up the view is in reading mode: the scroll stays, and each new entry is unseen until an
// IntersectionObserver reports it visible. Reaching the bottom, by scrolling or by the pill command, clears the unseen entries and
// follows again.
export interface FollowState {
  following: boolean;
  unseen: number;
}

export interface FollowView {
  // Whether the last entry is fully visible, within a small threshold.
  atBottom(): boolean;
  scrollToBottom(): void;
  // Runs after each change of the state.
  changed(state: FollowState): void;
}

export interface Follow {
  // The record indices of the entries that a draw added below the earlier entries.
  added(indices: number[]): void;
  // The IntersectionObserver reported the entry of the index visible.
  visible(index: number): void;
  // The scroll event of the view.
  scrolled(): void;
  // The pill command: scrolls to the bottom and follows again.
  bottom(): FollowState;
  state(): FollowState;
}

export function createFollow(view: FollowView): Follow {
  let following = true;
  const unseen = new Set<number>();
  const state = (): FollowState => ({ following, unseen: unseen.size });
  const publish = (): void => view.changed(state());
  const follow = (): void => {
    const changed = !following || unseen.size > 0;
    following = true;
    unseen.clear();
    if (changed) publish();
  };
  return {
    added(indices) {
      if (following) {
        view.scrollToBottom();
        return;
      }
      for (const index of indices) unseen.add(index);
      if (indices.length > 0) publish();
    },
    visible(index) {
      if (unseen.delete(index)) publish();
    },
    scrolled() {
      if (view.atBottom()) follow();
      else if (following) {
        following = false;
        publish();
      }
    },
    bottom() {
      view.scrollToBottom();
      follow();
      return state();
    },
    state,
  };
}
