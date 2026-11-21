// ACP 표준 형태의 최소 선언 — agents-acp 엔진이 검사·전달하는 형태와 동일(코어 의존 없이 타입만 공유).
export interface AcpSystemPromptLike {
  mode: "append" | "override";
  content: Array<{ type: "text"; text: string }>;
}
