// The conversation status of the room (docs/spec/room.md#conversation-status): the entries of the room record that the page shows,
// published at each change of the record.
import { describe, expect, it } from "vitest";
import manifest from "../../plugin.json";
import { createConversationStatus } from "./conversation-status";
import { createRoomRecord } from "./room-record";

const NAME = "soksak-plugin-agents-clubhouse.conversation";

describe("conversation status", () => {
  it("is declared in plugin.json with the entries {speaker, text}", () => {
    const status = manifest.exposes.status.find((entry) => entry.name === NAME);
    expect(status?.schema).toMatchObject({
      type: "object",
      properties: { entries: { type: "array", items: { required: ["speaker", "text"] } } },
      required: ["entries"],
    });
  });

  it("carries the record entries and publishes each change, also a withdrawn line", () => {
    const lines: { speaker: string; text: string }[] = [];
    const status = createConversationStatus(lines);
    const record = createRoomRecord(lines, {}, (speaker) => speaker, () => status.changed());
    const values: unknown[] = [];
    const stop = status.subscribe((value) => values.push(value));
    expect(status.read()).toEqual({ entries: [] });
    record.append("owner", "hello");
    record.append("reviewer", "hi");
    expect(status.read()).toEqual({ entries: [{ speaker: "owner", text: "hello" }, { speaker: "reviewer", text: "hi" }] });
    record.append("owner", "again");
    record.withdrawLast(2);
    expect(values).toEqual([
      { entries: [{ speaker: "owner", text: "hello" }] },
      { entries: [{ speaker: "owner", text: "hello" }, { speaker: "reviewer", text: "hi" }] },
      { entries: [{ speaker: "owner", text: "hello" }, { speaker: "reviewer", text: "hi" }, { speaker: "owner", text: "again" }] },
      { entries: [{ speaker: "owner", text: "hello" }, { speaker: "reviewer", text: "hi" }] },
    ]);
    stop();
    record.append("owner", "after");
    expect(values).toHaveLength(4);
  });

  it("gives copies, so a reader cannot change the record", () => {
    const lines = [{ speaker: "owner", text: "hello" }];
    const status = createConversationStatus(lines);
    const value = status.read() as { entries: { text: string }[] };
    value.entries[0].text = "changed";
    expect(lines[0].text).toBe("hello");
  });
});
