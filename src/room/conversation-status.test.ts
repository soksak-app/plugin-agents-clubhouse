// The conversation status of the room (docs/spec/room.md#conversation-status): the entries of the room record that the page shows,
// published at each change of the record.
import { describe, expect, it } from "vitest";
import manifest from "../../plugin.json";
import { createConversationStatus, waitLabel } from "./conversation-status";
import { createRoomRecord, type RecordLine } from "./room-record";

const NAME = "soksak-plugin-agents-clubhouse.conversation";

describe("conversation status", () => {
  it("is declared in plugin.json with the entries, the waits with their steps, and the delivery with the unreceived lines", () => {
    const status = manifest.exposes.status.find((entry) => entry.name === NAME);
    expect(status?.schema).toMatchObject({
      type: "object",
      properties: {
        entries: { type: "array", items: { required: ["speaker", "text", "at", "elapsedMs", "index", "sections"] } },
        waiting: { type: "array", items: { required: ["member", "session", "step", "program"], properties: { step: { enum: ["protocol", "turn", "answer"] } } } },
        delivery: { type: "array", items: { required: ["member", "name", "role", "session", "sent", "delivered", "length", "unreceived"] } },
        questions: { type: "array", items: { required: ["member", "session", "rows", "choices"] } },
      },
      required: ["entries", "waiting", "delivery", "questions"],
    });
  });

  it("carries the record entries with their times (docs/spec/room.md#timing) and publishes each change, also a withdrawn line", () => {
    const lines: RecordLine[] = [];
    const status = createConversationStatus(lines, () => [], () => []);
    const record = createRoomRecord(lines, {}, (speaker) => speaker, () => status.changed(), {}, () => 1000);
    const values: unknown[] = [];
    const stop = status.subscribe((value) => values.push(value));
    expect(status.read()).toEqual({ entries: [], waiting: [], delivery: [], questions: [] });
    record.append("owner", "hello");
    record.append("reviewer", "hi");
    expect(status.read()).toEqual({ entries: [{ speaker: "owner", text: "hello", at: 1000, elapsedMs: null, index: null, sections: [] }, { speaker: "reviewer", text: "hi", at: 1000, elapsedMs: null, index: null, sections: [] }], waiting: [], delivery: [], questions: [] });
    record.append("owner", "again");
    record.withdrawLast(2);
    expect(values).toEqual([
      { entries: [{ speaker: "owner", text: "hello", at: 1000, elapsedMs: null, index: null, sections: [] }], waiting: [], delivery: [], questions: [] },
      { entries: [{ speaker: "owner", text: "hello", at: 1000, elapsedMs: null, index: null, sections: [] }, { speaker: "reviewer", text: "hi", at: 1000, elapsedMs: null, index: null, sections: [] }], waiting: [], delivery: [], questions: [] },
      { entries: [{ speaker: "owner", text: "hello", at: 1000, elapsedMs: null, index: null, sections: [] }, { speaker: "reviewer", text: "hi", at: 1000, elapsedMs: null, index: null, sections: [] }, { speaker: "owner", text: "again", at: 1000, elapsedMs: null, index: null, sections: [] }], waiting: [], delivery: [], questions: [] },
      { entries: [{ speaker: "owner", text: "hello", at: 1000, elapsedMs: null, index: null, sections: [] }, { speaker: "reviewer", text: "hi", at: 1000, elapsedMs: null, index: null, sections: [] }], waiting: [], delivery: [], questions: [] },
    ]);
    stop();
    record.append("owner", "after");
    expect(values).toHaveLength(4);
  });

  it("carries the delivery entries of the members (docs/spec/room.md#conversation-status)", () => {
    const entry = { member: "reviewer", name: "Claude", session: "s-1", sent: 1, delivered: 1, length: 2, unreceived: 1 };
    const status = createConversationStatus([], () => [], () => [entry]);
    expect(status.read().delivery).toEqual([entry]);
  });

  it("gives copies, so a reader cannot change the record", () => {
    const lines = [{ speaker: "owner", text: "hello", at: null, elapsedMs: null, index: null }];
    const status = createConversationStatus(lines, () => [], () => []);
    const value = status.read() as { entries: { text: string }[] };
    value.entries[0].text = "changed";
    expect(lines[0].text).toBe("hello");
  });

  it("names each awaited member with its step and the program state of core.sessions, and publishes each begin, end and sessions value", () => {
    let sessions: unknown = [
      { session: "s-1", program: { state: "blocked" } },
      { session: "s-2", program: null },
    ];
    const status = createConversationStatus([], () => sessions, () => []);
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
    const status = createConversationStatus([], () => "x", () => []);
    expect(() => status.read()).toThrow("core.sessions is not a list");
    expect(() => status.waiting({ id: "reviewer", session: "s-1" }, "protocol")).toThrow("core.sessions is not a list");
  });
});

describe("waitLabel (docs/spec/room.md#conversation-status)", () => {
  it("shows an answer wait of an idle session as idle without answer, and every other wait by its step", () => {
    expect(waitLabel({ member: "a", session: "s", step: "answer", program: "idle" })).toBe("idle without answer");
    expect(waitLabel({ member: "a", session: "s", step: "answer", program: "working" })).toBe("answer");
    expect(waitLabel({ member: "a", session: "s", step: "protocol", program: "idle" })).toBe("protocol");
  });
});

describe("questions of the conversation status (docs/spec/room.md#questions)", () => {
  it("lists the question that the room read from the screen of each blocked member", () => {
    const questions = [{ member: "lead", session: "s-1", rows: [" Accessing workspace:", " ❯ No, exit"], choices: ["No, exit"] }];
    const status = createConversationStatus([], () => [], () => [], () => [], () => questions);
    expect(status.read().questions).toEqual(questions);
  });
});
