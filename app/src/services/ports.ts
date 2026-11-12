// Platform-free collaborators for the services. Real implementations live in src/adapters; tests pass fakes.
// Time is epoch ms; durations are seconds unless a name says otherwise.
export type { Clock } from '../data/ids';
export { systemClock } from '../data/ids';

/** The slice of a fetch Response the services use. The global `fetch` Response satisfies it. */
export interface HttpResponse {
  status: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface HttpRequestInit {
  method?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** The global `fetch`, narrowed. Services take it as a parameter so tests never touch the network. */
export type FetchLike = (url: string, init?: HttpRequestInit) => Promise<HttpResponse>;

/** Small text files by key (last good config, caches). Missing key reads as null; writes replace atomically. */
export interface TextStorage {
  read(key: string): Promise<string | null>;
  write(key: string, text: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export type Logger = (message: string) => void;
