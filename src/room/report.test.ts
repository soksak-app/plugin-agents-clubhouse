// The room error report (C12) against the view bridge calls of native-surfaces.md: tab.error shows the window toast and writes
// the record; a refused tab.error is recorded with runtime.error. The bridge double answers with the declared reply shapes.
import { describe, expect, it, vi } from "vitest";
import { createRoomReport, type ViewErrorApi } from "./report";

function bridge(tabError: (text: string) => Promise<unknown> = async () => null) {
  const requests: Array<{ command: string; params: unknown }> = [];
  const errors: Array<[string, string]> = [];
  const api: ViewErrorApi = {
    calls: {
      request: vi.fn(async (command: string, params: unknown) => {
        requests.push({ command, params });
        if (command === "tab.error") return tabError(params as string);
        return null;
      }),
    },
    runtime: {
      error: vi.fn(async (where: string, text: string) => {
        errors.push([where, text]);
        return null;
      }),
    },
  };
  return { api, requests, errors };
}

describe("createRoomReport — each failure is shown by the window through tab.error", () => {
  it("shows where and text through tab.error, and records nothing through runtime.error", async () => {
    const { api, requests, errors } = bridge();
    const report = createRoomReport();
    report.attach(api);
    report.report("room run", "SNAPSHOT_FAILED: rollback snapshot cannot be captured");
    await Promise.resolve();
    expect(requests).toEqual([{ command: "tab.error", params: "room run: SNAPSHOT_FAILED: rollback snapshot cannot be captured" }]);
    expect(errors).toEqual([]);
  });

  it("a report before the bridge is attached is shown when it attaches", async () => {
    const { api, requests } = bridge();
    const report = createRoomReport();
    report.report("start", "bridge not ready");
    expect(requests).toEqual([]);
    report.attach(api);
    await Promise.resolve();
    expect(requests).toEqual([{ command: "tab.error", params: "start: bridge not ready" }]);
  });

  it("a refused tab.error is recorded with runtime.error, keeping the full text", async () => {
    const { api, errors } = bridge(async () => {
      throw new Error("view call tab.error requires a text without control characters");
    });
    const report = createRoomReport();
    report.attach(api);
    report.report("room plan", "PLAN_PARSE_FAILED: line one\nline two");
    for (let i = 0; i < 5; i += 1) await Promise.resolve(); // flush the chained rejection of the call
    expect(errors).toEqual([
      [
        "room report",
        "tab.error refused (view call tab.error requires a text without control characters): room plan: PLAN_PARSE_FAILED: line one\nline two",
      ],
    ]);
  });
});
