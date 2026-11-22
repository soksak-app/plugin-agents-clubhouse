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
      properties: {
        entries: { type: "array", items: { required: ["speaker", "text"] } },
        waiting: { type: "array", items: { required: ["member", "session", "step", "program"] } },
      },
      required: ["entries", "waiting"],
    });
  });

  it("carries the record entries and publishes each change, also a withdrawn line", () => {
    const lines: { speaker: string; text: string }[] = [];
    const status = createConversationStatus(lines, () => []);
    const record = createRoomRecord(lines, {}, (speaker) => speaker, () => status.changed());
    const values: unknown[] = [];
    const stop = status.subscribe((value) => values.push(value));
    expect(status.read()).toEqual({ entries: [], waiting: [] });
    record.append("owner", "hello");
    record.append("reviewer", "hi");
    expect(status.read()).toEqual({ entries: [{ speaker: "owner", text: "hello" }, { speaker: "reviewer", text: "hi" }], waiting: [] });
    record.append("owner", "again");
    record.withdrawLast(2);
    expect(values).toEqual([
      { entries: [{ speaker: "owner", text: "hello" }], waiting: [] },
      { entries: [{ speaker: "owner", text: "hello" }, { speaker: "reviewer", text: "hi" }], waiting: [] },
      { entries: [{ speaker: "owner", text: "hello" }, { speaker: "reviewer", text: "hi" }, { speaker: "owner", text: "again" }], waiting: [] },
      { entries: [{ speaker: "owner", text: "hello" }, { speaker: "reviewer", text: "hi" }], waiting: [] },
    ]);
    stop();
    record.append("owner", "after");
    expect(values).toHaveLength(4);
  });

  it("gives copies, so a reader cannot change the record", () => {
    const lines = [{ speaker: "owner", text: "hello" }];
    const status = createConversationStatus(lines, () => []);
    const value = status.read() as { entries: { text: string }[] };
    value.entries[0].text = "changed";
    expect(lines[0].text).toBe("hello");
  });

  it("names each awaited member with its step and the program state of core.sessions, and publishes each begin, end and sessions value", () => {
    let sessions: unknown = [
      { session: "s-1", program: { state: "blocked" } },
      { session: "s-2", program: null },
    ];
    const status = createConversationStatus([], () => sessions);
    const values: unknown[] = [];
    status.subscribe((value) => values.push((value as { waiting: unknown }).waiting));
    const endFirst = status.waiting({ id: "reviewer", session: "s-1" }, "protocol");
    const endSecond = status.waiting({ id: "writer", session: "s-2" }, "answer");
    expect(status.read().waiting).toEqual([
      { member: "reviewer", session: "s-1", step: "protocol", program: "blocked" },
      { member: "writer", session: "s-2", step: "answer", program: null },
    ]);
    sessions = [{ session: "s-1", program: { state: "idle" } }];
    status.changed();
    expect(status.read().waiting).toEqual([
      { member: "reviewer", session: "s-1", step: "protocol", program: "idle" },
      { member: "writer", session: "s-2", step: "answer", program: "ended" },
    ]);
    endFirst();
    endFirst();
    endSecond();
    expect(status.read().waiting).toEqual([]);
    expect(values).toEqual([
      [{ member: "reviewer", session: "s-1", step: "protocol", program: "blocked" }],
      [
        { member: "reviewer", session: "s-1", step: "protocol", program: "blocked" },
        { member: "writer", session: "s-2", step: "answer", program: null },
      ],
      [
        { member: "reviewer", session: "s-1", step: "protocol", program: "idle" },
        { member: "writer", session: "s-2", step: "answer", program: "ended" },
      ],
      [{ member: "writer", session: "s-2", step: "answer", program: "ended" }],
      [],
    ]);
  });

  it("refuses a value of core.sessions that is not a list", () => {
    const status = createConversationStatus([], () => "x");
    expect(() => status.read()).toThrow("core.sessions is not a list");
    expect(() => status.waiting({ id: "reviewer", session: "s-1" }, "protocol")).toThrow("core.sessions is not a list");
  });
});
