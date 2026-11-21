// conversation — Clubhouse 대화 순수 로직(앱/DOM 비의존 — vitest 단위검증 대상).
// 참여자(탭 순서)·순차 발화자·델타 계산·교환 실행·@멘션·진행자 지시 파싱.
// 실 연결/세션은 주입된 turn() 뒤로 숨긴다 — 실행 로직을 실 에이전트·인증 없이 결정적으로 검증.
//
// 모델(확정):
//  - 로스터 = 탭(드래그 정렬). 탭 순서 = 발화 순서. 체크된 것 = 참여자.
//  - 모드: turn(순차)=각 1회 탭 순서 / simul(동시)=병렬 1회 / facil(진행)=진행자가 동시/순차/선택으로 조율
//    (라이브 driveFacilitated 는 main.ts). 라운드로빈('free')은 폐기.
//  - 지속 세션: 멤버별 세션 1개(재사용). 매 턴은 봉투(room/envelope)가 '새로 온 글'만 전달(deltaFor).

export interface RosterEntry {
  id: string;
  checked: boolean;
}
export type KibitzMode = "turn" | "facil" | "simul";
export interface Utterance {
  who: string; // 에이전트 id 또는 "human"
  text: string;
}

export type TurnFn = (agentId: string, prompt: string) => Promise<string>;

// 참여자 = 체크된 에이전트, 탭(배열) 순서 보존 = 발화 순서.
export function participants(roster: RosterEntry[]): string[] {
  return roster.filter((r) => r.checked).map((r) => r.id);
}

// 다음 발화자 — 참여자 각 1회(탭 순서). 한 바퀴 돌면 끝(null). 라운드로빈 폐기 — 한 라운드만.
export function nextSpeaker(parts: string[], agentTurnCount: number): string | null {
  return agentTurnCount < parts.length ? parts[agentTurnCount] : null;
}

// 진행자(facilitator) 기본값 = 체크된 첫 에이전트(탭 순서). 없으면 null. (UI 의 명시 facilitatorId 가 우선)
export function pickFacilitator(roster: RosterEntry[]): string | null {
  const p = participants(roster);
  return p.length ? p[0] : null;
}

export type FacilPattern = "simul" | "turn" | "select" | "none";
// 진행자 발화에서 오케스트레이션 지시 추출 — 다음에 누구를 어떻게 부를지.
//  targets = @지목된 동료(detectMentions 재사용). pattern: '다 같이/동시' → simul, '차례로/순차' → turn,
//  @지목만(태그 없음) → select(그 동료만), 지시 전무 → none(진행자만 답 = 마무리 신호).
//  봉투가 진행자에게 영어 지침("all together"/"one by one"/"@name")을 주므로 영어 패턴도 매칭.
export function parseFacilitatorDirective(
  text: string,
  roster: string[],
  facilitatorId: string,
  nameOf: (id: string) => string,
): { pattern: FacilPattern; targets: string[] } {
  const targets = detectMentions(text, roster, facilitatorId, nameOf);
  const simul =
    /\[동시\]|다\s*같이|동시에|모두\s*(답|의견|말)|all\s+together|in\s+parallel|everyone\b/i.test(text);
  const seq = /\[순차\]|차례(로|대로)|순서대로|돌아가|one\s+by\s+one|in\s+turn\b/i.test(text);
  let pattern: FacilPattern;
  if (simul) pattern = "simul";
  else if (seq) pattern = "turn";
  else if (targets.length) pattern = "select";
  else pattern = "none";
  return { pattern, targets };
}

// 델타 계산 — 멤버의 cursor(마지막으로 자기 발언을 본 위치) 이후만 잘라낸다. cursor 0 = 세션 첫 턴 → 전체.
export function deltaFor(
  cursor: number,
  conversation: Utterance[],
): { utterances: Utterance[]; kind: "full" | "delta" } {
  const cut = Math.max(0, Math.min(cursor, conversation.length));
  return { utterances: conversation.slice(cut), kind: cut === 0 ? "full" : "delta" };
}

// driveExchange — 한 교환(참여자 각 1회, 탭 순서). 헤드리스 converse·테스트용. 라이브는 main.ts driveSequential.
// 각 발화: prompt(speaker) 로 봉투를 받아 turn(). turn() 실패/빈 응답은 그 발화만 건너뛴다(대화 지속).
// 참견(consumeInterject true)이면 그 발화 폐기 + 같은 화자 재시작. conversation 공유(in-place) — 발화는 여기서 push.
export async function driveExchange(opts: {
  roster: RosterEntry[];
  conversation: Utterance[];
  turn: TurnFn;
  prompt: (speaker: string) => string;
  consumeInterject?: () => boolean;
  onTurnStart?: (speaker: string) => void;
  onUtterance?: (u: Utterance) => void;
  onDiscard?: (speaker: string) => void;
}): Promise<void> {
  const parts = participants(opts.roster);
  let agentTurns = 0;
  for (;;) {
    const speaker = nextSpeaker(parts, agentTurns);
    if (!speaker) break;
    opts.onTurnStart?.(speaker);
    let text = "";
    try {
      text = (await opts.turn(speaker, opts.prompt(speaker))).trim();
    } catch {
      text = ""; // 실패 → 빈 발화로 취급(건너뜀)
    }
    if (opts.consumeInterject?.()) {
      opts.onDiscard?.(speaker);
      continue; // 사람 참견 — 발화 폐기, 같은 화자 재시작(턴 미advance)
    }
    if (text) {
      const u: Utterance = { who: speaker, text };
      opts.conversation.push(u);
      opts.onUtterance?.(u);
    }
    agentTurns++;
  }
}

// driveSimul — 동시(simul) 모드. 턴테이킹 없음: 전원이 같은 맥락(스냅샷)을 보고 **병렬로** 1회씩 응답.
// 서로의 동시 응답은 못 본다(스냅샷 고정). 완료 발화는 도착 순서대로 push. 참견·재시작 없음(원샷 라운드).
export async function driveSimul(opts: {
  roster: RosterEntry[];
  conversation: Utterance[];
  turn: TurnFn;
  prompt: (speaker: string) => string;
  onTurnStart?: (speaker: string) => void;
  onUtterance?: (u: Utterance) => void;
}): Promise<void> {
  const parts = participants(opts.roster);
  const snapshot = opts.conversation.slice(); // 고정 — 전원 동일 맥락(서로의 동시 응답은 안 보임)
  await Promise.all(
    parts.map(async (speaker) => {
      opts.onTurnStart?.(speaker);
      let text = "";
      try {
        text = (await opts.turn(speaker, opts.prompt(speaker))).trim();
      } catch {
        text = ""; // 실패 → 빈 발화(건너뜀, 다른 참여자엔 영향 없음)
      }
      if (text) {
        const u: Utterance = { who: speaker, text };
        opts.conversation.push(u);
        opts.onUtterance?.(u);
      }
    }),
  );
}

// 헤드리스 1교환(참견 없음) — driveExchange 위 얇은 래퍼. 대화 복사본으로 돌리고 이번 교환의 발화만 반환.
export async function runExchange(opts: {
  roster: RosterEntry[];
  conversation: Utterance[]; // 원본 변형 안 함(복사)
  turn: TurnFn;
  prompt: (speaker: string) => string;
  onUtterance?: (u: Utterance) => void;
}): Promise<Utterance[]> {
  const produced: Utterance[] = [];
  await driveExchange({
    roster: opts.roster,
    conversation: opts.conversation.slice(),
    turn: opts.turn,
    prompt: opts.prompt,
    onUtterance: (u) => {
      produced.push(u);
      opts.onUtterance?.(u);
    },
  });
  return produced;
}

// base 방 페르소나/캐노니컬 재주입은 폐지 — 지속 세션 모델에서 페르소나는 세션 생성 시 systemPrompt 로
// 주입되고(room/persona), 매 턴 전달은 room/envelope 의 봉투가 맡는다. 이 파일은 순수 오케스트레이션만.

// @멘션 — 작업 대화에서 '@이름' 또는 '@id' 로 특정 동료를 지목(직접 답 요청). 자기 자신 제외, 등장 순서·중복 제거.
// '@' 가 명시 신호 — '@' 없는 단순 이름 언급은 호명이 아니다. roster=방 구성 전원(체크 무관 — 구경꾼도 @지목되면 깨어남).
export function detectMentions(
  text: string,
  roster: string[],
  speaker: string,
  nameOf: (id: string) => string,
): string[] {
  const hay = text.toLowerCase();
  const out: { id: string; idx: number }[] = [];
  for (const id of roster) {
    if (id === speaker) continue;
    let best = -1;
    for (const cand of [nameOf(id), id]) {
      const i = hay.indexOf(("@" + cand).toLowerCase());
      if (i >= 0 && (best < 0 || i < best)) best = i;
    }
    if (best >= 0) out.push({ id, idx: best });
  }
  out.sort((a, b) => a.idx - b.idx);
  return out.map((x) => x.id);
}
