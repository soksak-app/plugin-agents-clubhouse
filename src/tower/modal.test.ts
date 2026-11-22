// The parameter editor of a plan step accepts only a JSON object (C9): any other text is refused with null and the
// editor keeps the earlier value.
import { describe, expect, it } from "vitest";
import { failureReport, parseParamsObject } from "./modal";

describe("C9 — parseParamsObject accepts only a JSON object", () => {
  it("returns the object for a JSON object", () => {
    expect(parseParamsObject('{"name":"panel.close"}')).toEqual({ name: "panel.close" });
  });
  it("returns null for invalid JSON, an array, a number and null", () => {
    expect(parseParamsObject("{not json")).toBeNull();
    expect(parseParamsObject("[1]")).toBeNull();
    expect(parseParamsObject("42")).toBeNull();
    expect(parseParamsObject("null")).toBeNull();
  });
});

describe("C11 — a failed outcome is reported with its reason through the error path", () => {
  it("a successful outcome has no report", () => {
    expect(failureReport("tower run", { ok: true })).toBeNull();
  });
  it("SNAPSHOT_FAILED reports its code and its reason", () => {
    expect(
      failureReport("tower run", {
        ok: false,
        code: "SNAPSHOT_FAILED",
        message: "rollback snapshot cannot be captured, so the batch is refused before it runs: theme list refused",
      }),
    ).toEqual({
      where: "tower run",
      text: "SNAPSHOT_FAILED: rollback snapshot cannot be captured, so the batch is refused before it runs: theme list refused",
    });
  });
  it("every failure code keeps its reason, and a code without a message is still named", () => {
    expect(failureReport("tower run", { ok: false, code: "NEEDS_TARGET", message: "no open editor" })?.text).toBe("NEEDS_TARGET: no open editor");
    expect(failureReport("tower run", { ok: false, code: "CONFIRM_DENIED" })?.text).toBe("CONFIRM_DENIED");
  });
  it("a failure without a code or a message says that it has no reason, not a generic phrase", () => {
    expect(failureReport("tower plan", { ok: false })?.text).toBe("failed without a reason");
  });
});
