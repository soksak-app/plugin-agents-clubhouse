// Document collections over project data keys (core docs/spec/plugins.md#project-data). Each former project data collection is
// one declared key holding an array of documents; the whole array is one value, written with runtime.data.change.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProjectCollections } from "./collections";

const manifest = JSON.parse(readFileSync(join(process.cwd(), "plugin.json"), "utf8")) as {
  data: Record<string, { schema: unknown; default: unknown }>;
};

// A fake of the view's project data: values per key, with change applying next to the stored array.
function fakeData() {
  const values = new Map<string, unknown>();
  const keys: string[] = [];
  const read = (key: string) => (values.has(key) ? values.get(key) : []);
  return {
    keys,
    values,
    get: async (key: string) => {
      keys.push(key);
      return read(key);
    },
    set: async (key: string, value: unknown) => {
      keys.push(key);
      values.set(key, value);
    },
    change: async (key: string, next: (value: unknown) => unknown) => {
      keys.push(key);
      const value = next(structuredClone(read(key)));
      if (value !== undefined) values.set(key, value);
      return value;
    },
  };
}

describe("createProjectCollections", () => {
  it("stores a document under its declared key and returns its id", async () => {
    const data = fakeData();
    const collections = createProjectCollections(data);
    const id = await collections.put("tower_plans", { sessionId: "p", nl: "close the left panel" }, { id: "plan-1" });
    expect(id).toBe("plan-1");
    expect(data.keys).toEqual(["tower-plans"]);
    expect(await collections.get("tower_plans", "plan-1")).toEqual({ sessionId: "p", nl: "close the left panel", id: "plan-1" });
  });

  it("replaces a document with the same id instead of appending a second one", async () => {
    const data = fakeData();
    const collections = createProjectCollections(data);
    await collections.put("tower_plans", { sessionId: "p", outcome: "running" }, { id: "plan-1" });
    await collections.put("tower_plans", { sessionId: "p", outcome: "done" }, { id: "plan-1" });
    expect(data.values.get("tower-plans")).toEqual([{ sessionId: "p", outcome: "done", id: "plan-1" }]);
  });

  it("answers a query with the where filter, the order and the limit", async () => {
    const collections = createProjectCollections(fakeData());
    await collections.put("tower_steps", { sessionId: "p", planId: "a", seq: 2 }, { id: "s2" });
    await collections.put("tower_steps", { sessionId: "p", planId: "a", seq: 1 }, { id: "s1" });
    await collections.put("tower_steps", { sessionId: "p", planId: "b", seq: 0 }, { id: "s0" });
    const rows = await collections.query("tower_steps", { where: { sessionId: "p", planId: "a" }, order: "seq", desc: false, limit: 1 });
    expect(rows.map((r) => r.id)).toEqual(["s1"]);
  });

  it("refuses a collection that has no declared key", async () => {
    const collections = createProjectCollections(fakeData());
    await expect(collections.put("unknown_collection", { a: 1 })).rejects.toThrow(/unknown_collection is not a declared collection/);
  });

  it("maps each collection to a key of plugin.json whose schema is an array of objects with an empty default", () => {
    const keys = ["tower-plans", "tower-steps", "macros", "personas", "member-sessions"];
    for (const key of keys) {
      expect(manifest.data[key], key).toBeDefined();
      expect(manifest.data[key].schema, key).toEqual({ type: "array", items: { type: "object" } });
      expect(manifest.data[key].default, key).toEqual([]);
    }
  });
});
