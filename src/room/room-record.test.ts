// The room record (docs/spec/room.md#room-record): the lines of the owner and the answers in the order the room took them, the lines
// that a member session has not received, the delivered number of each session, which never falls, and the withdrawal of an owner line
// that no session received.
import { describe, expect, it } from "vitest";
import { createRoomRecord, leaderRoute, settledRelay } from "./room-record";

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

describe("addressed views (docs/spec/room.md#addressed-views)", () => {
  const MEMBERS = [{ id: "lead", name: "Lead", session: "s-l" }, { id: "w1", name: "W1", session: "s-1" }, { id: "w2", name: "W2", session: "s-2" }];
  const route = leaderRoute(() => "s-l", () => MEMBERS);

  it("gives the leader every line and a worker only the owner lines and the lines that mention it", () => {
    const record = createRoomRecord([], {}, nameOf, () => {}, {}, () => 0, {}, route);
    record.append("owner", "build a game");
    record.append("lead", "@W1 build the server");
    record.append("w2", "unrelated note");
    record.append("clubhouse", "@W2 claimed src/a.ts");
    expect(record.unsent("s-l", "lead")).toEqual([0, 2, 3]);
    expect(record.unsent("s-1", "w1")).toEqual([0, 1]);
    expect(record.unsent("s-2", "w2")).toEqual([0, 3]);
    expect(record.length("s-1")).toBe(2);
  });

  it("counts sent and delivered as positions in the addressed list", () => {
    const record = createRoomRecord([], {}, nameOf, () => {}, {}, () => 0, {}, route);
    record.append("owner", "go");
    record.append("lead", "@W1 do it");
    const pending = record.pending("s-1", "w1")!;
    expect(pending.count).toBe(2);
    record.markSent("s-1", pending.count);
    record.append("lead", "a line for nobody else");
    expect(record.pending("s-1", "w1")).toBeNull();
    record.append("lead", "@W1 and this");
    expect(record.pending("s-1", "w1")?.text).toBe("[@lead] @W1 and this");
    expect(() => record.markSent("s-1", 4)).toThrow("sent s-1 must be an integer from 0 to 3, got 4");
    expect(record.addressed()["s-1"]).toEqual([0, 1, 3]);
  });

  it("keeps every line addressed to every session without a leader", () => {
    const record = createRoomRecord([], {}, nameOf, () => {}, {}, () => 0, {}, leaderRoute(() => null, () => []));
    record.append("owner", "go");
    record.append("a", "x");
    expect(record.unsent("s-b", "b")).toEqual([0, 1]);
  });
});
