import { createHash, timingSafeEqual } from "node:crypto";
import { config, utcDate } from "./config";
import { deleteObjects, listPaths, putObject } from "./storage";

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  return (xff?.split(",")[0] || req.headers.get("x-real-ip") || "local").trim();
}

export function hashIp(ip: string): string {
  const salt = process.env.ADMIN_PASSWORD || "dev";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 24);
}

export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function inviteOk(code: unknown): boolean {
  const required = config.inviteCode;
  if (!required) return true;
  return typeof code === "string" && safeEqual(code, required);
}

export type LimitResult = { ok: true } | { ok: false; status: number; error: string };

/** Counts today's reservation markers: per-IP and global. Cheap pre-check; `reserve` re-counts, which is what actually enforces the caps. */
export async function checkLimits(ipHash: string): Promise<LimitResult> {
  const day = utcDate();
  const mine = await listPaths(`limits/${day}/${ipHash}/`, config.ipDailyCap);
  if (mine.length >= config.ipDailyCap) {
    return { ok: false, status: 429, error: "You've reached today's interview limit for this connection. Please try again tomorrow." };
  }
  const all = await listPaths(`limits/${day}/`, config.dailyCap);
  if (all.length >= config.dailyCap) {
    return { ok: false, status: 429, error: "We've reached today's interview capacity. Please try again tomorrow." };
  }
  return { ok: true };
}

const markerPath = (ipHash: string, id: string) => `limits/${utcDate()}/${ipHash}/${id}`;

/**
 * Take a slot BEFORE any paid OpenAI call: write our marker, count the markers, keep the slot only if the count is within
 * the cap. Blob has no atomic counter, so a plain check-then-write lets parallel requests all pass. With write-then-count
 * every racer sees every other racer's marker, so the caps are never exceeded; requests racing exactly at the limit may
 * all back off (they can simply retry), which is the safe direction for a paid API.
 */
export async function reserve(ipHash: string, id: string): Promise<LimitResult> {
  await putObject(markerPath(ipHash, id), "1", "text/plain");
  const day = utcDate();
  const mine = await listPaths(`limits/${day}/${ipHash}/`, config.ipDailyCap + 1);
  if (mine.length > config.ipDailyCap) {
    await releaseReservation(ipHash, id);
    return { ok: false, status: 429, error: "You've reached today's interview limit for this connection. Please try again tomorrow." };
  }
  const all = await listPaths(`limits/${day}/`, config.dailyCap + 1);
  if (all.length > config.dailyCap) {
    await releaseReservation(ipHash, id);
    return { ok: false, status: 429, error: "We've reached today's interview capacity. Please try again tomorrow." };
  }
  return { ok: true };
}

/** Give the slot back (the OpenAI call or the save failed, so no interview happened). */
export async function releaseReservation(ipHash: string, id: string): Promise<void> {
  await deleteObjects([markerPath(ipHash, id)]);
}
