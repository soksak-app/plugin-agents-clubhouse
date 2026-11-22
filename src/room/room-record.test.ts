// The room record (docs/spec/room.md#room-record): the lines of the owner and the answers in the order the room took them, the lines
// that a member session has not received, the delivered number of each session, which never falls, and the withdrawal of an owner line
// that no session received.
import { describe, expect, it } from "vitest";
import { createRoomRecord, settledRelay } from "./room-record";

const nameOf = (speaker: string): string => ({ owner: "owner", a: "Alpha", b: "Beta" })[speaker] ?? speaker;

describe("createRoomRecord", () => {
  it("gives a session every line it has not received, without its own lines, as one line", () => {
    const record = createRoomRecord([], {}, nameOf, () => {});
    record.append("owner", "hi\nall");
    record.append("a", "hello");
    record.append("b", "hey");
    expect(record.pending("s-a", "a")).toEqual({ text: "[@owner] hi all | [@Beta] hey", speakers: ["owner", "b"], count: 3 });
    record.markDelivered("s-a", 3);
    expect(record.pending("s-a", "a")).toBeNull();
    record.append("owner", "next");
    expect(record.pending("s-a", "a")?.text).toBe("[@owner] next");
    expect(record.delivered()).toEqual({ "s-a": 3 });
  });

  it("starts from the stored delivered numbers", () => {
    const record = createRoomRecord([{ speaker: "owner", text: "one", at: null, elapsedMs: null }, { speaker: "a", text: "two", at: null, elapsedMs: null }], { "s-b": 1 }, nameOf, () => {});
    expect(record.pending("s-b", "b")?.text).toBe("[@Alpha] two");
  });

  it("withdraws only the last line, and refuses to withdraw a line that a session received", () => {
    let changes = 0;
    const record = createRoomRecord([], {}, nameOf, () => void (changes += 1));
    record.append("owner", "one");
    expect(record.withdrawLast(1)).toBe(false);
    expect(record.withdrawLast(0)).toBe(true);
    expect(record.lines).toMatchObject([]);
    expect(changes).toBe(2);
    record.append("owner", "two");
    record.markDelivered("s-a", 1);
    expect(() => record.withdrawLast(0)).toThrow("record line 0 was delivered to session s-a");
  });

  it("raises a delivered number and refuses a number that falls or exceeds the record", () => {
    const record = createRoomRecord([{ speaker: "owner", text: "one", at: null, elapsedMs: null }, { speaker: "a", text: "two", at: null, elapsedMs: null }], {}, nameOf, () => {});
    record.markDelivered("s-a", 2);
    record.markDelivered("s-a", 1);
    expect(() => record.markDelivered("s-a", 3)).toThrow("delivered s-a must be an integer from 0 to 2, got 3");
    expect(record.delivered()).toEqual({ "s-a": 2 });
  });
});

describe("settledRelay", () => {
  it("removes the owner line of a relay in which core accepted no submit and rejects with the failure", async () => {
    const record = createRoomRecord([], {}, nameOf, () => {});
    record.append("owner", "hi");
    await expect(settledRelay(record, async () => { throw new Error("no member has the room protocol"); })).rejects.toThrow(
      "no member has the room protocol",
    );
    expect(record.lines).toMatchObject([]);
  });

  it("keeps the owner line of a relay that fails after an accepted submit and appends the failure line of the room", async () => {
    const record = createRoomRecord([], {}, nameOf, () => {});
    record.append("owner", "hi");
    await expect(
      settledRelay(record, async (accepted) => {
        accepted();
        throw new Error("member b: failed");
      }),
    ).rejects.toThrow("member b: failed");
    expect(record.lines).toMatchObject([
      { speaker: "owner", text: "hi" },
      { speaker: "clubhouse", text: "the relay failed: member b: failed" },
    ]);
  });
});
