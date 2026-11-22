// The size of a session that the room opens (docs/spec/room.md#restart): the measured size of the room card. A card that is not laid
// out yet, or a hidden room, measures zero; the size resolves at the first resize event that gives a positive size.
import { describe, expect, it } from "vitest";
import { measuredCardSize } from "./card-size";

function card(initial: { width: number; height: number; scale: number }) {
  const target = new EventTarget();
  let size = initial;
  return {
    view: {
      size: () => size,
      onResize: (listener: () => void) => {
        target.addEventListener("resize", listener);
        return () => target.removeEventListener("resize", listener);
      },
    },
    resize(next: typeof initial) {
      size = next;
      target.dispatchEvent(new Event("resize"));
    },
    listeners: () => target,
  };
}

describe("measuredCardSize", () => {
  it("resolves at once with a positive size", async () => {
    const c = card({ width: 400, height: 300, scale: 2 });
    await expect(measuredCardSize(c.view)).resolves.toEqual({ width: 400, height: 300, scale: 2 });
  });

  it("waits for the resize event that gives a positive size, so no session opens with a zero size", async () => {
    const c = card({ width: 0, height: 0, scale: 2 });
    let resolved: unknown = null;
    const pending = measuredCardSize(c.view).then((value) => (resolved = value));
    c.resize({ width: 300, height: 0, scale: 2 });
    await Promise.resolve();
    expect(resolved).toBeNull();
    c.resize({ width: 300, height: 200, scale: 2 });
    await pending;
    expect(resolved).toEqual({ width: 300, height: 200, scale: 2 });
  });
});
