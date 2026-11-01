import { deleteObjects, getJson, listPaths, putObject } from "./storage";
import { hangup } from "./openai";
import { ID_RE, type Interview } from "./types";

export const metaPath = (id: string) => `interviews/${id}.json`;
export const activePath = (id: string) => `active/${id}.json`;
export const audioPrefix = (id: string) => `audio/${id}/`;
export const audioPath = (id: string, seq: number) => `audio/${id}/${String(seq).padStart(4, "0")}`;

export function validId(id: string): boolean {
  return ID_RE.test(id);
}

export async function loadInterview(id: string): Promise<Interview | null> {
  if (!validId(id)) return null;
  return getJson<Interview>(metaPath(id));
}

export async function saveInterview(iv: Interview): Promise<void> {
  await putObject(metaPath(iv.id), JSON.stringify(iv));
}

/** Mark finished, hang up the OpenAI call, drop the active marker. Idempotent. */
export async function finish(iv: Interview, status: Interview["status"]): Promise<Interview> {
  if (iv.status === "active") {
    iv.status = status;
    iv.endedAt = new Date().toISOString();
    iv.durationSec = Math.max(0, Math.round((Date.parse(iv.endedAt) - Date.parse(iv.startedAt)) / 1000));
    await saveInterview(iv);
  }
  if (iv.callId) await hangup(iv.callId);
  await deleteObjects([activePath(iv.id)]);
  return iv;
}

export async function listInterviews(max = 200): Promise<Interview[]> {
  const paths = (await listPaths("interviews/", 1000)).filter((p) => p.endsWith(".json")).sort().reverse().slice(0, max);
  const all = await Promise.all(paths.map((p) => getJson<Interview>(p)));
  return all.filter((x): x is Interview => Boolean(x)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function deleteInterview(id: string): Promise<void> {
  const parts = await listPaths(audioPrefix(id), 2000);
  await deleteObjects([metaPath(id), activePath(id), ...parts]);
}
