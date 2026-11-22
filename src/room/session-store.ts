// The member sessions of a room in project data (docs/spec/room.md#restart): one document per member, whose identifier is
// `<room surface>/<agentId>`, so two rooms of one project keep separate relations. The store reads only this form and refuses any other.
// The part of the project data collections that the store uses.
export interface RoomDataApi {
  define: (coll: string, opts: { indexes?: string[]; fts?: string[] }) => Promise<void>;
  put: (coll: string, doc: Record<string, unknown>, opts?: { id?: string; scope?: string }) => Promise<string>;
  get: (coll: string, id: string, opts?: { scope?: string }) => Promise<Record<string, unknown> | null>;
}

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

const FIELDS = ["id", "surface", "agentId", "sessionId", "cwd", "savedAt"];

export function createMemberSessionStore(data: RoomDataApi, surface: string): MemberSessionStore {
  if (typeof surface !== "string" || surface === "") throw new Error("the member session store needs the room surface");
  let defined: Promise<void> | null = null;
  // A failed define is not kept: the rejected promise is dropped so that the next call defines again.
  const ensure = () => {
    defined ??= data.define(MEMBER_SESSIONS, { indexes: ["agentId"] }).catch((error: unknown) => {
      defined = null;
      throw error;
    });
    return defined;
  };
  const idOf = (agentId: string): string => `${surface}/${agentId}`;
  return {
    async get(agentId) {
      await ensure();
      const id = idOf(agentId);
      const doc = await data.get(MEMBER_SESSIONS, id);
      if (doc === null) return null;
      const field = Object.keys(doc).find((key) => !FIELDS.includes(key));
      if (field !== undefined) throw new Error(`${MEMBER_SESSIONS} ${id}: unknown field ${field}`);
      if (doc.surface !== surface) throw new Error(`${MEMBER_SESSIONS} ${id}: surface must be ${surface}, got ${JSON.stringify(doc.surface)}`);
      if (doc.agentId !== agentId) throw new Error(`${MEMBER_SESSIONS} ${id}: agentId must be ${agentId}, got ${JSON.stringify(doc.agentId)}`);
      for (const key of ["sessionId", "cwd"] as const) {
        if (typeof doc[key] !== "string" || doc[key] === "") throw new Error(`${MEMBER_SESSIONS} ${id}: ${key} must be a non-empty string, got ${JSON.stringify(doc[key])}`);
      }
      if (!Number.isFinite(doc.savedAt)) throw new Error(`${MEMBER_SESSIONS} ${id}: savedAt must be a number, got ${JSON.stringify(doc.savedAt)}`);
      return { agentId, sessionId: doc.sessionId as string, cwd: doc.cwd as string, savedAt: doc.savedAt as number };
    },
    async put(session) {
      await ensure();
      await data.put(MEMBER_SESSIONS, { surface, ...session }, { id: idOf(session.agentId) });
    },
  };
}
