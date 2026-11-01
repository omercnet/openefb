import { del, get, list, put } from "@vercel/blob";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";

/**
 * Vercel Blob (private store) in production. Local dev without Blob credentials
 * falls back to ./.data so `npm run dev` works with just OPENAI_API_KEY.
 */
const useBlob = Boolean(
  process.env.BLOB_READ_WRITE_TOKEN ||
    (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN),
);
const ROOT = path.resolve(process.cwd(), ".data");

function fsPath(p: string): string {
  const full = path.resolve(ROOT, p);
  if (!full.startsWith(ROOT + path.sep)) throw new Error("bad path");
  return full;
}

function assertStorage() {
  if (!useBlob && process.env.VERCEL) {
    throw new Error("No Blob storage configured: set BLOB_READ_WRITE_TOKEN");
  }
}

export async function putObject(
  p: string,
  body: string | Uint8Array,
  contentType = "application/json",
): Promise<void> {
  assertStorage();
  if (useBlob) {
    await put(p, body as string | Buffer, {
      access: "private",
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType,
    });
    return;
  }
  const f = fsPath(p);
  await mkdir(path.dirname(f), { recursive: true });
  await writeFile(f, body);
}

export async function getObject(
  p: string,
): Promise<{ stream: ReadableStream<Uint8Array>; size: number | null } | null> {
  assertStorage();
  if (useBlob) {
    const r = await get(p, { access: "private", useCache: false });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    return { stream: r.stream, size: r.blob.size };
  }
  const f = fsPath(p);
  try {
    const s = await stat(f);
    return {
      stream: Readable.toWeb(createReadStream(f)) as ReadableStream<Uint8Array>,
      size: s.size,
    };
  } catch {
    return null;
  }
}

export async function getText(p: string): Promise<string | null> {
  const o = await getObject(p);
  if (!o) return null;
  return await new Response(o.stream).text();
}

export async function getJson<T>(p: string): Promise<T | null> {
  const t = await getText(p);
  return t ? (JSON.parse(t) as T) : null;
}

/** List object paths under a prefix; stops after `max` entries. */
export async function listPaths(prefix: string, max = 1000): Promise<string[]> {
  assertStorage();
  const out: string[] = [];
  if (useBlob) {
    let cursor: string | undefined;
    do {
      const r = await list({ prefix, cursor, limit: Math.min(1000, max - out.length) });
      out.push(...r.blobs.map((b) => b.pathname));
      cursor = r.hasMore ? r.cursor : undefined;
    } while (cursor && out.length < max);
    return out.slice(0, max);
  }
  async function walk(dir: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else out.push(path.relative(ROOT, full).split(path.sep).join("/"));
    }
  }
  await walk(ROOT);
  return out.filter((x) => x.startsWith(prefix)).slice(0, max);
}

export async function deleteObjects(paths: string[]): Promise<void> {
  if (!paths.length) return;
  assertStorage();
  if (useBlob) {
    await del(paths);
    return;
  }
  await Promise.all(paths.map((p) => rm(fsPath(p), { force: true })));
}
