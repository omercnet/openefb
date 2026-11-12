// In-memory stand-in for expo-file-system with the File and Directory behaviour the adapters use. Tests install it with
//   jest.mock('expo-file-system', () => jest.requireActual('<path to this file>'));
// and drive it through the exports below. URIs follow the real module: a Directory uri ends in "/", a File uri does
// not, and a space in a joined segment is percent-encoded.

type Entry = { kind: 'directory' } | { kind: 'file'; bytes: Uint8Array; creationTime: number | null };

const entries = new Map<string, Entry>();

/** Counters for file handles, so tests can assert every opened handle was closed. */
export const handles = { opened: 0, closed: 0 };
/** Errors the next calls throw, to exercise failure paths. */
export const failures: { delete?: Error; open?: Error; read?: Error } = {};

export const DOCUMENTS = 'file:///var/mobile/Containers/Data/Application/APP/Documents';

const trimEnd = (uri: string): string => uri.replace(/\/+$/, '');

type Part = string | { uri: string };

function join(...parts: Part[]): string {
  const [first = '', ...rest] = parts.map((p) => (typeof p === 'string' ? p : p.uri));
  // The native side reads a plain absolute path as the file URL of that path.
  const root = first.startsWith('/') ? `file://${first.replace(/ /g, '%20')}` : first;
  const tail = rest.map((s) => s.replace(/^\/+|\/+$/g, '').replace(/ /g, '%20'));
  return [trimEnd(root), ...tail].join('/');
}

export function reset(): void {
  entries.clear();
  handles.opened = 0;
  handles.closed = 0;
  delete failures.delete;
  delete failures.open;
  delete failures.read;
}

export function addDirectory(uri: string): void {
  entries.set(trimEnd(uri), { kind: 'directory' });
}

export function addFile(uri: string, bytes: Uint8Array = new Uint8Array(), creationTime: number | null = null): void {
  entries.set(trimEnd(uri), { kind: 'file', bytes, creationTime });
}

export function has(uri: string): boolean {
  return entries.has(trimEnd(uri));
}

export class File {
  readonly uri: string;

  constructor(...parts: Part[]) {
    this.uri = join(...parts);
    // expo-file-system SDK 58 (FileSystemFile.swift init): a File cannot be made for a path that is a directory.
    if (entries.get(this.uri)?.kind === 'directory') throw new Error(`${this.uri} is a directory, not a file`);
  }

  get name(): string {
    return this.uri.slice(this.uri.lastIndexOf('/') + 1);
  }

  get exists(): boolean {
    return entries.get(this.uri)?.kind === 'file';
  }

  get creationTime(): number | null {
    const entry = entries.get(this.uri);
    return entry?.kind === 'file' ? entry.creationTime : null;
  }

  get parentDirectory(): Directory {
    return new Directory(this.uri.slice(0, this.uri.lastIndexOf('/')));
  }

  delete(): void {
    if (failures.delete) throw failures.delete;
    if (!this.exists) throw new Error('File does not exist');
    entries.delete(this.uri);
  }

  open(): {
    offset: number | null;
    readonly size: number | null;
    readBytes(length: number): Promise<Uint8Array>;
    close(): void;
  } {
    const entry = entries.get(this.uri);
    if (failures.open) throw failures.open;
    if (entry?.kind !== 'file') throw new Error('File does not exist');
    handles.opened += 1;
    let closed = false;
    return {
      offset: 0,
      get size() {
        return closed ? null : entry.bytes.length;
      },
      async readBytes(length) {
        if (closed) throw new Error('handle is closed');
        if (failures.read) throw failures.read;
        const start = this.offset ?? 0;
        const chunk = entry.bytes.slice(start, start + length);
        this.offset = start + chunk.length;
        return chunk;
      },
      close() {
        closed = true;
        handles.closed += 1;
      },
    };
  }
}

export class Directory {
  /** With a trailing slash, as in expo-file-system. */
  readonly uri: string;

  constructor(...parts: Part[]) {
    this.uri = `${join(...parts)}/`;
  }

  get exists(): boolean {
    return entries.get(trimEnd(this.uri))?.kind === 'directory';
  }

  get parentDirectory(): Directory {
    const bare = trimEnd(this.uri);
    return new Directory(bare.slice(0, bare.lastIndexOf('/')));
  }

  list(): (File | Directory)[] {
    const prefix = this.uri;
    if (!this.exists) throw new Error('Directory does not exist');
    return [...entries.entries()]
      .filter(([uri]) => uri.startsWith(prefix) && !uri.slice(prefix.length).includes('/'))
      .map(([uri, entry]) => (entry.kind === 'file' ? new File(uri) : new Directory(uri)));
  }

  create(): void {
    addDirectory(this.uri);
  }
}

export const Paths = {
  get document(): Directory {
    return new Directory(DOCUMENTS);
  },
};

export const FileMode = { ReadOnly: 'r' } as const;
