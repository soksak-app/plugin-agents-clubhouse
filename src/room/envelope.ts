// 방 턴 봉투 — 멤버에게 주입될 이번 턴의 텍스트(영어 — 에이전트 대상 텍스트 규칙).
// 화자 문법([@owner]/[@member]/[@clubhouse])은 room/persona 의 프로토콜 블록이 이미 교육했다;
// 여기선 그 문법으로 '이번 턴에 새로 온 글'만 전달하고 종료 마커로 닫는다.
import { TURN_END_MARKER } from "./persona";
import type { KibitzMode, RosterEntry, Utterance } from "../conversation";

/** 한 포스트 — "[@화자] 내용" 한 줄. 개행은 공백으로 접힘(한 줄=한 포스트, 문법 단순·규칙적). */
export function formatPost(who: string, nameOf: (id: string) => string, text: string): string {
  const label = who === "human" ? "[@owner]" : who === "system" ? "[@clubhouse]" : `[@${nameOf(who)}]`;
  return `${label} ${text.replace(/\s*\n\s*/g, " ").trim()}`;
}

const MODE_NOTE: Record<KibitzMode, string> = {
  simul: "mode=simul — everyone answers at once; you cannot see the others' answers to this turn yet.",
  turn: "mode=turn — members speak one by one in order; keep yours short.",
  facil: "mode=facilitated — the facilitator runs the flow; answer when called or @mentioned.",
};

export function buildTurnEnvelope(opts: {
  speaker: string;
  roster: RosterEntry[];
  /** 전체(세션 첫 턴) 또는 델타(그 멤버가 마지막으로 본 이후) — 호출자가 deltaFor 로 결정. */
  utterances: Utterance[];
  mode: KibitzMode;
  /** 이 멤버가 진행자(facil) — 조율 지침을 [@clubhouse] 줄로 덧붙인다. */
  facilitator?: boolean;
  /** 진행자 하드캡 마지막 차례 — 정리 지침. */
  lastRound?: boolean;
  /** @지목으로 깨어난 턴 — 지목에 답하라는 줄. */
  mentioned?: boolean;
  nameOf: (id: string) => string;
  /** 추가 시스템 줄(오류·로스터 변경 등). */
  systemNotes?: string[];
}): string {
  const names = opts.roster.map((r) => opts.nameOf(r.id));
  const sys = (text: string) => formatPost("system", opts.nameOf, text);
  const head = [
    sys(`members=${names.join(", ")} · ${MODE_NOTE[opts.mode]}`),
    ...(opts.facilitator
      ? [
          sys(
            "You are the facilitator: answer the owner yourself, or call peers with @name — " +
              'say "all together" (everyone in parallel), "one by one" (sequential), or "@name" (that peer alone). ' +
              "Sum up what comes back; when you call nobody, the conversation ends." +
              (opts.lastRound ? " This is your last facilitation turn — wrap up." : ""),
          ),
        ]
      : []),
    ...(opts.mentioned ? [sys("You were @mentioned — answer the point addressed to you.")] : []),
    ...(opts.systemNotes ?? []).map((n) => sys(n)),
  ];
  const posts = opts.utterances.map((u) => formatPost(u.who, opts.nameOf, u.text));
  return [...head, ...posts, TURN_END_MARKER].join("\n");
}
