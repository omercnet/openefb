import { createHash, timingSafeEqual } from "node:crypto";
import { config, utcDate } from "./config";
import { listPaths, putObject } from "./storage";

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

/** Counts today's reservation markers: per-IP and global. Racy by a request or two; fine at this scale. */
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

export async function reserve(ipHash: string, id: string): Promise<void> {
  await putObject(`limits/${utcDate()}/${ipHash}/${id}`, "1", "text/plain");
}
