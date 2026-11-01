/** The only storage surface the job needs: Workers KV in production, a directory in the local fallback, a Map in tests. */
export interface Store {
  get(name: string): Promise<string | null>;
  put(name: string, body: string): Promise<void>;
}

/** The slice of a Workers KV namespace used here (kept structural so tests and Node need no Workers types). */
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export const kvStore = (kv: KVLike): Store => ({
  get: (name) => kv.get(name),
  put: (name, body) => kv.put(name, body),
});

export async function getJson<T>(store: Store, name: string): Promise<T | null> {
  const text = await store.get(name);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
