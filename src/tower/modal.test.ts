// The parameter editor of a plan step accepts only a JSON object (C9): any other text is refused with null and the
// editor keeps the earlier value.
import { describe, expect, it } from "vitest";
import { parseParamsObject } from "./modal";

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
