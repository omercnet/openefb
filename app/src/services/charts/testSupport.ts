// In-memory file system and scripted downloader for the chart and terminal-procedure tests. No disk, no network.
import { createHash } from 'crypto';
import { CancelledError, type ChartFileSystem, type DownloadRequest, type FileDownloader } from './ports';
import type { Sha256 } from './sha256';

export const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);
export const nodeSha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

export class MemoryFileSystem implements ChartFileSystem {
  readonly files = new Map<string, Uint8Array>();
  readonly dirs = new Set<string>();
  failWrites = false;
  hashed: string[] = [];

  join(...parts: string[]): string {
    return parts.join('/').replace(/\/+/g, '/');
  }
  exists(path: string): boolean {
    return this.files.has(path) || this.dirs.has(path);
  }
  size(path: string): number | null {
    return this.files.get(path)?.length ?? null;
  }
  async readText(path: string): Promise<string | null> {
    const data = this.files.get(path);
    return data ? new TextDecoder().decode(data) : null;
  }
  async writeText(path: string, text: string): Promise<void> {
    if (this.failWrites) throw new Error('disk full');
    this.put(path, bytesOf(text));
  }
  put(path: string, data: Uint8Array): void {
    this.files.set(path, data);
    this.mkdirs(path.split('/').slice(0, -1).join('/'));
  }
  private mkdirs(dir: string): void {
    const parts = dir.split('/');
    for (let i = 1; i <= parts.length; i++) this.dirs.add(parts.slice(0, i).join('/'));
  }
  async readHead(path: string, count: number): Promise<Uint8Array | null> {
    return this.files.get(path)?.slice(0, count) ?? null;
  }
  async hashFile(path: string, hasher: Sha256): Promise<void> {
    const data = this.files.get(path);
    if (!data) throw new Error(`no such file: ${path}`);
    this.hashed.push(path);
    for (let i = 0; i < data.length; i += 1000) hasher.update(data.subarray(i, i + 1000));
  }
  async ensureDir(path: string): Promise<void> {
    this.mkdirs(path);
  }
  async move(from: string, to: string): Promise<void> {
    if (this.exists(to)) throw new Error(`destination exists: ${to}`);
    for (const [p, data] of [...this.files]) {
      if (p === from || p.startsWith(`${from}/`)) {
        this.files.delete(p);
        this.put(to + p.slice(from.length), data);
      }
    }
    for (const d of [...this.dirs]) {
      if (d === from || d.startsWith(`${from}/`)) {
        this.dirs.delete(d);
        this.dirs.add(to + d.slice(from.length));
      }
    }
    this.mkdirs(to);
  }
  async remove(path: string): Promise<void> {
    for (const p of [...this.files.keys()]) if (p === path || p.startsWith(`${path}/`)) this.files.delete(p);
    for (const d of [...this.dirs]) if (d === path || d.startsWith(`${path}/`)) this.dirs.delete(d);
  }
  async list(path: string): Promise<string[]> {
    const names = new Set<string>();
    for (const p of [...this.files.keys(), ...this.dirs]) {
      if (p.startsWith(`${path}/`)) names.add(p.slice(path.length + 1).split('/')[0]);
    }
    return [...names].sort();
  }
  /** Test helper: the text of a file. */
  text(path: string): string | undefined {
    const data = this.files.get(path);
    return data ? new TextDecoder().decode(data) : undefined;
  }
}

export interface ScriptedReply {
  status: number;
  body?: Uint8Array;
}

/** A downloader that answers from `handler(request, callNumber)`; a throw is a transport failure. Honours range
 * requests the way the real one must: 206 appends, 200 replaces. */
export class ScriptedDownloader implements FileDownloader {
  readonly requests: DownloadRequest[] = [];
  constructor(
    private readonly fs: MemoryFileSystem,
    private readonly handler: (request: DownloadRequest, call: number) => ScriptedReply | Promise<ScriptedReply>,
  ) {}

  async download(request: DownloadRequest): Promise<{ status: number }> {
    this.requests.push(request);
    if (request.signal?.aborted) throw new CancelledError();
    const reply = await this.handler(request, this.requests.length);
    if (request.signal?.aborted) throw new CancelledError();
    const body = reply.body ?? new Uint8Array();
    if (reply.status === 200) {
      this.fs.put(request.destination, body);
      request.onBytes?.(body.length);
    } else if (reply.status === 206) {
      const existing = this.fs.files.get(request.destination) ?? new Uint8Array();
      const merged = new Uint8Array(existing.length + body.length);
      merged.set(existing);
      merged.set(body, existing.length);
      this.fs.put(request.destination, merged);
      request.onBytes?.(merged.length);
    }
    return { status: reply.status };
  }
}
