// 멤버 세션 스토어 계약 — 실패는 호출자에게 거부로 전달되고, 부재 문서만 null 이다.
import { describe, it, expect } from "vitest";
import { createMemberSessionStore, MEMBER_SESSIONS } from "./session-store";
import type { PersonaDataApi } from "./persona";

function fakeData(): PersonaDataApi & { docs: Map<string, Record<string, unknown>> } {
  const docs = new Map<string, Record<string, unknown>>();
  return {
    docs,
    define: async () => {},
    put: async (_c, doc, opts) => {
      docs.set(opts?.id ?? String(docs.size), doc);
      return opts?.id ?? "0";
    },
    get: async (_c, id) => docs.get(id) ?? null,
  };
}

const session = { agentId: "claude", sessionId: "s-1", cwd: "/work/app", savedAt: 1 };

describe("createMemberSessionStore — errors reach the caller", () => {
  it("a missing document reads as null", async () => {
    const s = createMemberSessionStore(fakeData())!;
    await expect(s.get("claude")).resolves.toBeNull();
  });
  it("a write then a read returns the stored session", async () => {
    const s = createMemberSessionStore(fakeData())!;
    await s.put(session);
    await expect(s.get("claude")).resolves.toEqual(session);
  });
  it("a failed data read rejects instead of returning null", async () => {
    const data = fakeData();
    data.get = async () => {
      throw new Error("project data unreadable");
    };
    const s = createMemberSessionStore(data)!;
    await expect(s.get("claude")).rejects.toThrow("project data unreadable");
  });
  it("a failed data write rejects", async () => {
    const data = fakeData();
    data.put = async () => {
      throw new Error("project data full");
    };
    const s = createMemberSessionStore(data)!;
    await expect(s.put(session)).rejects.toThrow("project data full");
  });
  it("a failed define rejects, and the next call defines again", async () => {
    const data = fakeData();
    const defined: string[] = [];
    data.define = async (coll) => {
      defined.push(coll);
      if (defined.length === 1) throw new Error("define refused");
    };
    const s = createMemberSessionStore(data)!;
    await expect(s.get("claude")).rejects.toThrow("define refused");
    await expect(s.get("claude")).resolves.toBeNull();
    expect(defined).toEqual([MEMBER_SESSIONS, MEMBER_SESSIONS]);
  });
});
