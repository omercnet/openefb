// Port of NotamReadStateStore (Services/NotamReadStateStore.swift): which NOTAMs the pilot has already read
// (IL-BRIEF). A NOTAM counts as read by its id *and* its created stamp, so a NOTAMR that replaces a read NOTAM (same
// series, new id and stamp) or a re-issue with the same id shows as unread again. A few hundred keys at most.
import type { IsraelNotam } from './israelNotam';
import type { Logger, TextStorage } from './ports';

/** Swift: UserDefaults key `israelNotamReadKeys`. */
export const NOTAM_READ_KEYS_STORAGE_KEY = 'IsraelNotam/read-keys.json';

export interface NotamReadStateStoreLike {
  isRead(notam: IsraelNotam): boolean;
  markRead(notam: IsraelNotam): void;
  markUnread(notam: IsraelNotam): void;
  markAllRead(notams: readonly IsraelNotam[]): void;
}

/** "C2269/26@2026-10-25T14:31:00Z"; a NOTAM without a created stamp is keyed by id alone. */
export function readKey(notam: Pick<IsraelNotam, 'id' | 'created'>): string {
  if (notam.created === null) return notam.id;
  // Swift .iso8601 writes whole seconds: drop the milliseconds.
  return `${notam.id}@${new Date(notam.created).toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
}

export class NotamReadStateStore implements NotamReadStateStoreLike {
  /** Keys of read NOTAMs (`readKey`). */
  private keys: Set<string>;
  private writeChain: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  private version = 0;

  private constructor(
    keys: Set<string>,
    private readonly storage: TextStorage | undefined,
    private readonly log: Logger | undefined,
  ) {
    this.keys = keys;
  }

  /** Loads the saved keys; a missing or damaged file reads as "nothing read". */
  static async open(storage?: TextStorage, log?: Logger): Promise<NotamReadStateStore> {
    let keys = new Set<string>();
    if (storage) {
      try {
        const raw = await storage.read(NOTAM_READ_KEYS_STORAGE_KEY);
        const parsed: unknown = raw === null ? [] : JSON.parse(raw);
        if (Array.isArray(parsed)) keys = new Set(parsed.filter((k): k is string => typeof k === 'string'));
      } catch {
        // unreadable: start empty
      }
    }
    return new NotamReadStateStore(keys, storage, log);
  }

  get readKeys(): ReadonlySet<string> {
    return this.keys;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  isRead(notam: IsraelNotam): boolean {
    return this.keys.has(readKey(notam));
  }

  markRead(notam: IsraelNotam): void {
    const key = readKey(notam);
    if (this.keys.has(key)) return;
    this.replace(new Set(this.keys).add(key));
  }

  markUnread(notam: IsraelNotam): void {
    const next = new Set(this.keys);
    if (!next.delete(readKey(notam))) return;
    this.replace(next);
  }

  markAllRead(notams: readonly IsraelNotam[]): void {
    const next = new Set(this.keys);
    for (const n of notams) next.add(readKey(n));
    if (next.size !== this.keys.size) this.replace(next);
  }

  /** Drop keys of NOTAMs no longer in the feed, so the list never grows without bound. */
  prune(keeping: readonly IsraelNotam[]): void {
    const live = new Set(keeping.map(readKey));
    const kept = new Set([...this.keys].filter((k) => live.has(k)));
    if (kept.size !== this.keys.size) this.replace(kept);
  }

  /** Resolves when every save started so far has finished. */
  flush(): Promise<void> {
    return this.writeChain;
  }

  private replace(next: Set<string>): void {
    this.keys = next;
    this.version += 1;
    this.persist([...next].sort());
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        this.log?.(`NOTAM read-state listener failed: ${String(error)}`);
      }
    }
  }

  private persist(sorted: string[]): void {
    const storage = this.storage;
    if (!storage) return;
    this.writeChain = this.writeChain.then(async () => {
      try {
        await storage.write(NOTAM_READ_KEYS_STORAGE_KEY, JSON.stringify(sorted));
      } catch (error) {
        this.log?.(`Could not save the NOTAM read state: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }
}
