import { randomBytes } from "node:crypto";
import { config, utcDate } from "@/lib/config";
import { activePath, saveInterview } from "@/lib/interviews";
import { noiseReductionFor, sessionConfig } from "@/lib/interviewer";
import { parseDevice, parseLang } from "@/lib/lang";
import { checkLimits, clientIp, hashIp, inviteOk, reserve } from "@/lib/limits";
import { createCall, hangup } from "@/lib/openai";
import { putObject } from "@/lib/storage";
import { CONSENT_VERSION, type Interview } from "@/lib/types";

export const dynamic = "force-dynamic";

function cleanMic(v: unknown): NonNullable<Interview["noise"]>["mic"] {
  if (!v || typeof v !== "object") return undefined;
  const m = v as Record<string, unknown>;
  const b = (x: unknown) => (typeof x === "boolean" ? x : undefined);
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
  return { noiseSuppression: b(m.noiseSuppression), echoCancellation: b(m.echoCancellation), autoGainControl: b(m.autoGainControl), channelCount: n(m.channelCount), sampleRate: n(m.sampleRate) };
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Starts an interview. Server-side gates, in order: consent, API key, invite code, per-IP and daily caps.
 * Only then is the SDP offer exchanged with OpenAI (unified WebRTC interface), so the API key and the
 * interviewer instructions never reach the browser.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 100_000) return json({ error: "Request too large" }, 413);
  let body: { sdp?: unknown; consent?: unknown; consentVersion?: unknown; code?: unknown; lang?: unknown; device?: unknown; mic?: unknown; ambientDb?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  if (body.consent !== true || body.consentVersion !== CONSENT_VERSION) {
    return json({ error: "Consent is required before the interview can start." }, 400);
  }
  if (typeof body.sdp !== "string" || !body.sdp.startsWith("v=0")) {
    return json({ error: "A WebRTC offer is required." }, 400);
  }
  if (!process.env.OPENAI_API_KEY) return json({ error: "Interview service is not configured." }, 503);
  if (!inviteOk(body.code)) return json({ error: "This interview link is not valid." }, 403);

  const ipHash = hashIp(clientIp(req));
  const limit = await checkLimits(ipHash);
  if (!limit.ok) return json({ error: limit.error }, limit.status);

  const lang = parseLang(body.lang);
  const device = parseDevice(body.device);
  const call = await createCall(body.sdp, sessionConfig(lang, device), ipHash);
  if ("error" in call) {
    console.error("OpenAI createCall failed", call.status, call.error);
    return json({ error: "Could not start the voice session. Please try again in a minute." }, 502);
  }

  const id = `${utcDate()}-${randomBytes(16).toString("hex")}`;
  const now = new Date().toISOString();
  const iv: Interview = {
    id,
    status: "active",
    startedAt: now,
    consentAt: now,
    consentVersion: CONSENT_VERSION,
    callId: call.callId ?? undefined,
    ipHash,
    model: config.model,
    lang,
    noise: {
      device,
      reduction: noiseReductionFor(device),
      turnDetection: config.turnDetection,
      mic: cleanMic(body.mic),
      ambientDb: typeof body.ambientDb === "number" && Number.isFinite(body.ambientDb) ? Math.round(body.ambientDb) : undefined,
    },
    transcript: [],
  };
  try {
    await saveInterview(iv);
    await reserve(ipHash, id);
    await putObject(activePath(id), JSON.stringify({ id, callId: iv.callId, startedAt: now }));
  } catch (e) {
    console.error("storage failed at session start", e);
    if (call.callId) await hangup(call.callId);
    return json({ error: "Storage error. Please try again later." }, 500);
  }

  return json({ id, sdp: call.answer, maxSeconds: config.maxSessionSeconds });
}
