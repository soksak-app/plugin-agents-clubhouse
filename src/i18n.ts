// UI 문자열 외부화 — t(key, lang) / tp(key, lang, vars) 로 소비.
// 에러 메시지·LLM 시스템 프롬프트·내부 처리용 문자열은 이 파일 대상 아님.

const strings = {
  placeholder: {
    en: "Message… (Enter to send, Shift+Enter for newline, @ to mention a model, @all for everyone)",
    ko: "메시지… (Enter 전송, Shift+Enter 줄바꿈, @로 모델 지목, @all은 모두)",
  },
  sendBtn: {
    en: "Send",
    ko: "전송",
  },
  stopBtn: {
    en: "Stop",
    ko: "중지",
  },
  statusIdle: {
    en: "Idle",
    ko: "대기",
  },
  busy: {
    en: "Working…",
    ko: "작업 중…",
  },
  modeTurn: {
    en: "Sequential",
    ko: "순차",
  },
  modeSimul: {
    en: "Simultaneous",
    ko: "동시",
  },
  termOpen: {
    en: "Open this member's terminal (its session, resumed)",
    ko: "이 멤버의 터미널 열기(같은 세션을 이어서)",
  },
  termNoSession: {
    en: "No session yet — run one turn first",
    ko: "세션이 아직 없습니다 — 한 턴을 먼저 진행하세요",
  },
  termOpenFail: {
    en: "Terminal open failed",
    ko: "터미널 열기 실패",
  },
  sessionHeld: {
    en: "session is held by another client (its TUI?) — turn deferred",
    ko: "세션을 다른 클라이언트(TUI?)가 잡고 있음 — 이 턴은 건너뜁니다",
  },
  crownTitle: {
    en: "Set as facilitator",
    ko: "진행자로 지정",
  },
  statusInterject: {
    en: "Interjected — reflected after current utterance ends",
    ko: "참견 — 현재 발화 종결 후 반영",
  },
  statusQueued: {
    en: "Queued — reflected after current conversation ends",
    ko: "대기 중 — 현재 대화가 끝나면 반영",
  },
  railNoBinding: {
    en: "No clubhouse view bound",
    ko: "결부된 클럽하우스 뷰 없음",
  },
  modalTitle: {
    en: "{who} is speaking",
    ko: "{who} 말하는 중",
  },
  modalMsg: {
    en: "Cut in now, or add after they finish?",
    ko: "지금 끼어들까요, 끝나면 넣을까요?",
  },
  btnCut: {
    en: "Cut now",
    ko: "지금 끊기",
  },
  btnWait: {
    en: "Add after",
    ko: "끝나면 넣기",
  },
  btnCancel: {
    en: "Cancel",
    ko: "취소",
  },
  pending: {
    en: "Responding…",
    ko: "응답 중…",
  },
  thinkBadge: {
    en: "💭 Think",
    ko: "💭 생각",
  },
  thinkBadgeTitle: {
    en: "Click to expand/collapse reasoning",
    ko: "클릭하면 리소닝 펼치기/접기",
  },
  whoMe: {
    en: "Me",
    ko: "나",
  },
  queuedTag: {
    en: " · queued",
    ko: " · 대기 중",
  },
  statusSimul: {
    en: "Responding simultaneously…",
    ko: "동시 응답 중…",
  },
  statusFacilDone: {
    en: "Facilitation cap reached — wrapping up",
    ko: "진행 한도 도달 — 마무리",
  },
  whoConversation: {
    en: "Conversation",
    ko: "대화",
  },
  waitingFor: {
    en: "waiting for {name}: {step}, program {program}",
    ko: "{name} 기다리는 중: {step}, program {program}",
  },
  questionAsks: {
    en: "The program of {name} asks a question and waits for its answer:",
    ko: "{name}의 프로그램이 질문하고 답을 기다립니다:",
  },
  questionAnswer: {
    en: "Answer in the {name} tab",
    ko: "{name} 탭에서 답하기",
  },
  transportUnavailable: {
    en: "No member of the room has an open session.",
    ko: "열린 세션이 있는 방 멤버가 없습니다.",
  },
  groupChoose: {
    en: "Choose a group",
    ko: "그룹 선택",
  },
  foldButton: {
    en: "Fold",
    ko: "접기",
  },
  unfoldButton: {
    en: "Unfold",
    ko: "펼치기",
  },
  stateAnswering: {
    en: "answering",
    ko: "응답 중",
  },
  stateIdle: {
    en: "idle",
    ko: "대기",
  },
  stateNone: {
    en: "no session",
    ko: "세션 없음",
  },
  transportReady: {
    en: "Connected: messages go to the checked members with an open session.",
    ko: "연결됨: 메시지는 열린 세션이 있는 체크된 멤버에게 갑니다.",
  },
  unseen: {
    en: "{count} new ↓",
    ko: "새 대화 {count}개 ↓",
  },
  round: {
    en: "round {round}",
    ko: "{round}번째 round",
  },
  notIsolated: {
    en: "Not isolated from personal settings: {members}.",
    ko: "개인 설정에서 격리되지 않음: {members}.",
  },
} as const;

export type I18nKey = keyof typeof strings;

/** 순수 번역 함수 — lang 없으면 en 폴백. */
export function t(key: I18nKey, lang: string): string {
  const e = strings[key];
  return (e as Record<string, string>)[lang] ?? e.en;
}

/** 플레이스홀더({key}) 치환 포함 번역 함수. */
export function tp(key: I18nKey, lang: string, vars: Record<string, string>): string {
  let s = t(key, lang);
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}
