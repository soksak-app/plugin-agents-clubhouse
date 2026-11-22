// The shared record of a mention exchange (docs/spec/room.md#shared-record): each member outside the exchange receives the record lines that it
// has not received as one submitted line, the room waits for no turn of it, and a member that is not idle or a refused submit is reported.
import { describe, expect, it } from "vitest";
import { recordText, shareRecord, type RecordPorts } from "./record";
import { createRoomRecord } from "./room-record";

const claude = { id: "reviewer", name: "Claude", session: "s-1" };
const codex = { id: "writer", name: "Codex", session: "s-2" };
const tester = { id: "tester", name: "Tester", session: "s-3" };
const helper = { id: "helper", name: "Helper", session: "s-4" };

function fakeCore(states: Record<string, string | null>, refuse?: string) {
  const submitted: { session: string; text: string }[] = [];
  const reports: string[] = [];
  const ports: RecordPorts = {
    commands: {
      execute: async (name, params) => {
        if (name !== "core.session.submit") throw new Error(`unexpected command ${name}`);
        if (params.session === refuse) throw new Error("core.session.submit refused");
        submitted.push({ session: params.session as string, text: params.text as string });
        return {};
      },
    },
    sessions: () => Object.entries(states).map(([session, state]) => ({ session, program: state === null ? null : { state } })),
  };
  return { ports, submitted, reports, report: (where: string, text: string) => void reports.push(`${where}: ${text}`) };
}

const nameOf = (speaker: string): string => (speaker === "owner" ? "owner" : ([claude, codex, tester, helper].find((m) => m.id === speaker)?.name ?? speaker));

// The record after a mention exchange of the owner with Claude and Codex.
function exchangeRecord() {
  const record = createRoomRecord([], {}, nameOf, () => {});
  record.append("owner", "@Claude @Codex review\nthis");
  record.append("reviewer", "looks good");
  record.append("writer", "one fix\nneeded");
  return record;
}
const TEXT =
  "답은 하지말고 알고있어. [@owner]와 [@Claude], [@Codex]의 대화기록이다. 답하지말고 참고해. | [@owner] @Claude @Codex review this | [@Claude] looks good | [@Codex] one fix needed";

describe("recordText", () => {
  it("names the owner and the speaking members with speaker labels and joins the record lines with ' | '", () => {
    expect(recordText(exchangeRecord().pending("s-3", "tester")!, nameOf)).toBe(TEXT);
  });
});

describe("shareRecord", () => {
  it("submits the record to each other idle member in roster order, sets its delivered number, and no line contains CR or LF", async () => {
    const core = fakeCore({ "s-3": "idle", "s-4": "idle" });
    const record = exchangeRecord();
    await shareRecord(core.ports, record, [tester, helper], nameOf, core.report);
    expect(core.submitted).toEqual([{ session: "s-3", text: TEXT }, { session: "s-4", text: TEXT }]);
    expect(core.submitted.some((entry) => /[\r\n]/.test(entry.text))).toBe(false);
    expect(record.delivered()).toEqual({ "s-3": 3, "s-4": 3 });
    expect(core.reports).toEqual([]);
  });

  it("sends a member only the lines that it has not received", async () => {
    const core = fakeCore({ "s-3": "idle" });
    const record = exchangeRecord();
    record.markDelivered("s-3", 2);
    await shareRecord(core.ports, record, [tester], nameOf, core.report);
    expect(core.submitted).toEqual([
      { session: "s-3", text: "답은 하지말고 알고있어. [@owner]와 [@Codex]의 대화기록이다. 답하지말고 참고해. | [@Codex] one fix needed" },
    ]);
  });

  it("sends no record to a member that is not idle and reports it", async () => {
    const core = fakeCore({ "s-3": "working", "s-4": "idle" });
    const record = exchangeRecord();
    await shareRecord(core.ports, record, [tester, helper], nameOf, core.report);
    expect(core.submitted.map((entry) => entry.session)).toEqual(["s-4"]);
    expect(record.delivered()).toEqual({ "s-4": 3 });
    expect(core.reports).toEqual(["room record: member tester is working: record not sent"]);
  });

  it("reports a refused submit with its reason and still sends to the next member", async () => {
    const core = fakeCore({ "s-3": "idle", "s-4": "idle" }, "s-3");
    await shareRecord(core.ports, exchangeRecord(), [tester, helper], nameOf, core.report);
    expect(core.submitted.map((entry) => entry.session)).toEqual(["s-4"]);
    expect(core.reports).toEqual(["room record: member tester: core.session.submit refused"]);
  });
});
