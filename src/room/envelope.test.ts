// 턴 봉투 계약 — 화자 라벨 문법·모드 노트·진행자/지목 줄·마커 종결. 한 줄=한 포스트.
import { describe, it, expect } from "vitest";
import { buildTurnEnvelope, formatPost } from "./envelope";
import { TURN_END_MARKER } from "./persona";
import type { RosterEntry, Utterance } from "../conversation";

const roster: RosterEntry[] = [
  { id: "claude", checked: true },
  { id: "codex", checked: true },
];
const nameOf = (id: string): string => ({ claude: "Claude", codex: "Codex" })[id] ?? id;

describe("formatPost — 화자 라벨 한 줄", () => {
  it("human → [@owner], 에이전트 → [@이름], system → [@clubhouse]", () => {
    expect(formatPost("human", nameOf, "안녕")).toBe("[@owner] 안녕");
    expect(formatPost("codex", nameOf, "승인")).toBe("[@Codex] 승인");
    expect(formatPost("system", nameOf, "mode 변경")).toBe("[@clubhouse] mode 변경");
  });
  it("멀티라인 본문은 공백으로 접힘(한 줄=한 포스트)", () => {
    expect(formatPost("codex", nameOf, "첫줄\n둘째줄\n\n셋째")).toBe("[@Codex] 첫줄 둘째줄 셋째");
  });
});

describe("buildTurnEnvelope — 이번 턴 봉투", () => {
  const conv: Utterance[] = [
    { who: "human", text: "다 같이 의견 줘요" },
    { who: "claude", text: "찬성" },
  ];
  const base = {
    speaker: "codex",
    roster,
    mode: "simul" as const,
    nameOf,
  };
  it("헤더(멤버·모드 노트) + 화자 라벨 포스트 + 종료 마커", () => {
    const e = buildTurnEnvelope({ ...base, utterances: conv });
    const lines = e.split("\n");
    expect(lines[0]).toContain("[@clubhouse]");
    expect(lines[0]).toContain("members=Claude, Codex");
    expect(lines[0]).toContain("mode=simul");
    expect(lines).toContain("[@owner] 다 같이 의견 줘요");
    expect(lines).toContain("[@Claude] 찬성");
    expect(lines[lines.length - 1]).toBe(TURN_END_MARKER);
  });
  it("진행자 봉투 — 조율 지침(영어) 줄이 포함된다", () => {
    const e = buildTurnEnvelope({ ...base, mode: "facil", facilitator: true, utterances: conv });
    expect(e).toContain("facilitator");
    expect(e).toContain("all together");
    expect(e).toContain("one by one");
  });
  it("마지막 진행 차례 — 정리 지침", () => {
    const e = buildTurnEnvelope({ ...base, mode: "facil", facilitator: true, lastRound: true, utterances: [] });
    expect(e).toContain("last facilitation turn");
  });
  it("@지목 턴 — 지목 응답 줄", () => {
    const e = buildTurnEnvelope({ ...base, mentioned: true, utterances: [] });
    expect(e).toContain("@mentioned");
  });
  it("시스템 노트 줄(오류 등)", () => {
    const e = buildTurnEnvelope({ ...base, utterances: [], systemNotes: ["codex 세션 갱신됨"] });
    expect(e).toContain("[@clubhouse] codex 세션 갱신됨");
  });
  it("델타가 비어도 헤더+마커는 전달(새 글 없는 턴)", () => {
    const e = buildTurnEnvelope({ ...base, utterances: [] });
    expect(e).toContain("mode=simul");
    expect(e.endsWith(TURN_END_MARKER)).toBe(true);
  });
});
