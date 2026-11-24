// Document collections of the room over project data (core docs/spec/plugins.md#project-data). Each collection is one declared
// data key whose value is an array of documents; a write replaces the whole array through runtime.data.change, so two writers
// keep each other's documents. The collection names are the names that the stores (member session) use.

export type Doc = Record<string, unknown> & { id: string };

// The project data of the view: change applies next to a copy of the stored value and stores what next returns.
export interface KeyedData {
  get(key: string): Promise<unknown>;
  change(key: string, next: (value: unknown) => unknown): Promise<unknown>;
}

// The data key of each collection, as declared in plugin.json `data`.
export const COLLECTION_KEYS: Record<string, string> = {
  room_member_sessions: "member-sessions",
};

export interface Collections {
  define(collection: string, options?: { indexes?: string[]; fts?: string[] }): Promise<void>;
  put(collection: string, doc: Record<string, unknown>, options?: { id?: string; scope?: string }): Promise<string>;
  get(collection: string, id: string, options?: { scope?: string }): Promise<Doc | null>;
  query(collection: string, options: Record<string, unknown>): Promise<Doc[]>;
}

export function createProjectCollections(data: KeyedData): Collections {
  // A collection outside COLLECTION_KEYS has no declared key, so it is refused rather than stored elsewhere.
  const keyOf = (collection: string): string => {
    const key = COLLECTION_KEYS[collection];
    if (key === undefined) throw new Error(`${collection} is not a declared collection`);
    return key;
  };
  const rowsOf = async (collection: string): Promise<Doc[]> => {
    const value = await data.get(keyOf(collection));
    if (!Array.isArray(value)) throw new Error(`project data ${keyOf(collection)} holds no document array`);
    return value as Doc[];
  };
  return {
    // The keys are declared, so there is no table to create.
    async define(collection) {
      keyOf(collection);
    },
    async put(collection, doc, options) {
      const key = keyOf(collection);
      const id = options?.id ?? globalThis.crypto.randomUUID();
      await data.change(key, (value) => {
        const rows = Array.isArray(value) ? (value as Doc[]) : [];
        return [...rows.filter((row) => row.id !== id), { ...doc, id }];
      });
      return id;
    },
    async get(collection, id) {
      return (await rowsOf(collection)).find((row) => row.id === id) ?? null;
    },
    async query(collection, options) {
      const where = (options.where ?? {}) as Record<string, unknown>;
      let rows = (await rowsOf(collection)).filter((row) => Object.entries(where).every(([field, value]) => row[field] === value));
      const order = typeof options.order === "string" ? options.order : undefined;
      if (order) {
        const direction = options.desc === true ? -1 : 1;
        rows = [...rows].sort((a, b) => {
          const x = a[order] as number | string;
          const y = b[order] as number | string;
          return x < y ? -direction : x > y ? direction : 0;
        });
      }
      if (typeof options.limit === "number") rows = rows.slice(0, options.limit);
      return rows;
    },
  };
}
