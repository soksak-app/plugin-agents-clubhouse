// The room record (docs/spec/room.md#room-record): the lines of the owner and the answers in the order the room took them, the lines
// that a member session has not received, the delivered number of each session, and the withdrawal of an owner line that no member
// answered.
import { describe, expect, it } from "vitest";
import { createRoomRecord, withdrawnOnFailure } from "./room-record";

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
    const record = createRoomRecord([{ speaker: "owner", text: "one" }, { speaker: "a", text: "two" }], { "s-b": 1 }, nameOf, () => {});
    expect(record.pending("s-b", "b")?.text).toBe("[@Alpha] two");
  });

  it("withdraws only the last line and lowers the delivered numbers above the new length", () => {
    let changes = 0;
    const record = createRoomRecord([], {}, nameOf, () => void (changes += 1));
    record.append("owner", "one");
    record.markDelivered("s-a", 1);
    expect(record.withdrawLast(1)).toBe(false);
    expect(record.withdrawLast(0)).toBe(true);
    expect(record.lines).toEqual([]);
    expect(record.delivered()).toEqual({ "s-a": 0 });
    expect(changes).toBe(3);
  });
});

describe("withdrawnOnFailure", () => {
  it("removes the owner line of a relay that fails before any answer and rejects with the failure", async () => {
    const record = createRoomRecord([], {}, nameOf, () => {});
    record.append("owner", "hi");
    await expect(withdrawnOnFailure(record, async () => { throw new Error("no member has the room protocol"); })).rejects.toThrow(
      "no member has the room protocol",
    );
    expect(record.lines).toEqual([]);
  });

  it("keeps the owner line of a relay that fails after an answer", async () => {
    const record = createRoomRecord([], {}, nameOf, () => {});
    record.append("owner", "hi");
    await expect(
      withdrawnOnFailure(record, async () => {
        record.append("a", "hello");
        throw new Error("member b: failed");
      }),
    ).rejects.toThrow("member b: failed");
    expect(record.lines.map((line) => line.speaker)).toEqual(["owner", "a"]);
  });
});
