// 페르소나 조립·저장 계약 — 프로토콜(고정)이 먼저, 사용자 텍스트가 뒤. 저장은 room.data 컬렉션.
import { describe, it, expect } from "vitest";
import {
  TURN_END_MARKER,
  PERSONAS,
  assemblePersona,
  roomProtocolBlock,
  starterPersona,
  createPersonaStore,
  type PersonaDataApi,
} from "./persona";

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

describe("roomProtocolBlock — 방 문법 교육", () => {
  it("화자 라벨·마커·인용-데이터 규칙·멤버 목록 포함(전부 영어)", () => {
    const b = roomProtocolBlock(["codex", "gemini"]);
    expect(b).toContain("[@owner]");
    expect(b).toContain("[@<member>]");
    expect(b).toContain("[@clubhouse]");
    expect(b).toContain(TURN_END_MARKER);
    expect(b).toContain("quoted data");
    expect(b).toContain("@<name>");
    expect(b).toContain("codex, gemini");
  });
  it("멤버 없으면 (none yet)", () => {
    expect(roomProtocolBlock([])).toContain("Members of this room: (none yet).");
  });
});

describe("assemblePersona — 조립 순서와 폴백", () => {
  it("프로토콜 먼저, 사용자 페르소나 뒤(사용자 텍스트가 우선 문맥)", () => {
    const b = assemblePersona("claude", "You are a careful reviewer.", ["codex"]);
    expect(b.assembled.indexOf("## Clubhouse room protocol")).toBe(0);
    expect(b.assembled).toContain("You are a careful reviewer.");
    expect(b.assembled.indexOf("Clubhouse room protocol")).toBeLessThan(b.assembled.indexOf("careful reviewer"));
  });
  it("빈 페르소나 → 스타터 템플릿", () => {
    const b = assemblePersona("codex", "   \n", []);
    expect(b.persona).toBe(starterPersona("codex"));
    expect(b.assembled).toContain("## codex");
  });
});

describe("createPersonaStore — room.data 컬렉션", () => {
  it("부재 doc → 빈 문자열(호출자가 스타터로 폴백)", async () => {
    const s = createPersonaStore(fakeData());
    await expect(s!.read("claude")).resolves.toBe("");
  });
  it("쓰기→읽기 왕복(같은 id 갱신)", async () => {
    const data = fakeData();
    const s = createPersonaStore(data)!;
    await s.write("claude", "first");
    await s.write("claude", "second");
    expect(data.docs.get("claude")?.text).toBe("second");
    await expect(s.read("claude")).resolves.toBe("second");
    expect(data.docs.size).toBe(1);
  });
  it("room.data 미부여 → undefined(스토어 없음, 스타터로만 동작)", () => {
    expect(createPersonaStore(undefined)).toBeUndefined();
  });
});
