// The size of a session that the room opens (docs/spec/room.md#restart): the card size of the room view in points and the backing
// scale. A view that is not laid out yet, or that is hidden, measures zero; the size resolves at the first resize event of the view
// that gives a positive width and height, so no session opens with a size that core refuses.
import type { SessionSize } from "./summon";

export interface CardView {
  size(): SessionSize;
  // Subscribes to the resize events of the view and returns the function that ends the subscription.
  onResize(listener: () => void): () => void;
}

const positive = (size: SessionSize): boolean =>
  [size.width, size.height, size.scale].every((value) => Number.isFinite(value) && value > 0);

export function measuredCardSize(view: CardView): Promise<SessionSize> {
  const now = view.size();
  if (positive(now)) return Promise.resolve(now);
  return new Promise((resolve) => {
    const off = view.onResize(() => {
      const next = view.size();
      if (!positive(next)) return;
      off();
      resolve(next);
    });
  });
}
