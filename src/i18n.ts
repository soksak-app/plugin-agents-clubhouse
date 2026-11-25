// The text of the page elements in English and Korean, read with t(key, lang) and tp(key, lang, vars). Error texts and the lines that
// the room submits to members are not in this file.

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
  busy: {
    en: "Working…",
    ko: "작업 중…",
  },
  pending: {
    en: "Responding…",
    ko: "응답 중…",
  },
  modeTurn: {
    en: "Sequential",
    ko: "순차",
  },
  modeSimul: {
    en: "Simultaneous",
    ko: "동시",
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
    en: "No group with members is assigned to the room.",
    ko: "멤버가 있는 그룹이 방에 지정되지 않았습니다.",
  },
  groupChoose: {
    en: "Choose a group",
    ko: "그룹 선택",
  },
  endMember: {
    en: "End",
    ko: "끝내기",
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
    en: "Connected: a message goes to the members it mentions and to the leader.",
    ko: "연결됨: 메시지는 멘션한 멤버와 리더에게 갑니다.",
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
