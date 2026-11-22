// 멤버 세션 영속 — 뷰가 내려가도 세션 id 를 project data 에 보관해, 재마운트 때 같은 세션을 resume 한다.
// 지속 세션 모델의 회복 경로: 메모리 캐시(뷰 수명) → 이 스토어(앱 수명) → 세션 파일(디스크, 에이전트 소유).
import type { PersonaDataApi } from "./persona";

export const MEMBER_SESSIONS = "room_member_sessions";

export interface StoredMemberSession {
  agentId: string;
  sessionId: string;
  cwd: string;
  savedAt: number;
}

export interface MemberSessionStore {
  get(agentId: string): Promise<StoredMemberSession | null>;
  put(session: StoredMemberSession): Promise<void>;
}

/** project data 미부여 환경이면 undefined — 영속 없이 메모리 수명으로만 동작(기능 무해 축소). */
export function createMemberSessionStore(data?: PersonaDataApi): MemberSessionStore | undefined {
  if (!data) return undefined;
  let defined: Promise<void> | null = null;
  // A failed define is not kept: the rejected promise is dropped so that the next call defines again.
  const ensure = () => {
    defined ??= data.define(MEMBER_SESSIONS, { indexes: ["agentId"] }).catch((error: unknown) => {
      defined = null;
      throw error;
    });
    return defined;
  };
  return {
    async get(agentId) {
      await ensure();
      const doc = await data.get(MEMBER_SESSIONS, agentId);
      return doc && typeof doc.sessionId === "string" && typeof doc.cwd === "string"
        ? { agentId, sessionId: doc.sessionId, cwd: doc.cwd, savedAt: Number(doc.savedAt) || 0 }
        : null;
    },
    async put(session) {
      await ensure();
      await data.put(MEMBER_SESSIONS, { ...session }, { id: session.agentId });
    },
  };
}
