// Fakes shared by the service tests: clock, storage, fetch. No network, no disk.
import type { Clock, FetchLike, HttpRequestInit, HttpResponse, TextStorage } from './ports';

export class TestClock {
  constructor(private current: number) {}
  now: Clock = () => this.current;
  advance(seconds: number): void {
    this.current += seconds * 1000;
  }
}

export class MemoryTextStorage implements TextStorage {
  readonly files = new Map<string, string>();
  writeCount = 0;
  failWrites = false;
  async read(key: string): Promise<string | null> {
    return this.files.get(key) ?? null;
  }
  async write(key: string, text: string): Promise<void> {
    if (this.failWrites) throw new Error('disk full');
    this.writeCount += 1;
    this.files.set(key, text);
  }
  async remove(key: string): Promise<void> {
    this.files.delete(key);
  }
}

export interface StubReply {
  status?: number;
  body?: string | ArrayBuffer;
}

export function response(reply: StubReply): HttpResponse {
  const body = reply.body ?? '';
  return {
    status: reply.status ?? 200,
    text: async () => (typeof body === 'string' ? body : new TextDecoder().decode(body)),
    arrayBuffer: async () => (typeof body === 'string' ? new TextEncoder().encode(body).buffer : body) as ArrayBuffer,
  };
}

export interface FakeFetch extends FetchLike {
  calls: { url: string; init?: HttpRequestInit }[];
}

/** A fetch that answers from `handler` (a reply, or a thrown error for a transport failure). */
export function fakeFetch(handler: (url: string, call: number) => StubReply | Promise<StubReply>): FakeFetch {
  const fn = (async (url: string, init?: HttpRequestInit) => {
    fn.calls.push({ url, init });
    return response(await handler(url, fn.calls.length));
  }) as FakeFetch;
  fn.calls = [];
  return fn;
}
