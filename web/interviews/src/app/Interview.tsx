"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { dirOf, type Device, type Lang } from "@/lib/lang";
import { CONSENT_VERSION, type Outcome, type TranscriptEntry } from "@/lib/types";
import { STRINGS, type Strings } from "./strings";

type Phase = "consent" | "starting" | "live" | "ending" | "done";
type Activity = "listening" | "hearing" | "thinking" | "speaking";
type EndStatus = "completed" | "dropped" | "capped";
// Realtime server events are loosely typed JSON
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ev = Record<string, any>;
interface Entry extends TranscriptEntry {
  itemId: string;
}

const PART_BYTES = 150_000; // upload audio in small parts (Vercel request bodies are capped at 4.5 MB)

/**
 * Browser-side cleanup before audio leaves the device. Mono (speech), 48 kHz (what WebRTC/Opus runs at). These are
 * requests: browsers may ignore them, so the applied values are read back from track.getSettings() and logged.
 */
const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: { ideal: 1 },
  sampleRate: { ideal: 48_000 },
};
const NOISE_CHECK_MS = 3000;
const NOISY_DBFS = -45; // mean ambient power above this (raw mic, no AGC/NS) is "noisy"; heuristic, tune with real calls
const SILENT_DBFS = -90;

type ErrKey = "errMicBlocked" | "errMicNone" | "errMicOther" | "errConsent" | "errLink" | "errLimit" | "errBusy" | "errGeneric";

function micErrorKey(e: unknown): ErrKey {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "errMicBlocked";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "errMicNone";
  return "errMicOther";
}

/** Server errors are English; map by HTTP status so the pilot sees them in their own language. */
function sessionErrorKey(status: number): ErrKey {
  if (status === 400) return "errConsent";
  if (status === 403) return "errLink";
  if (status === 429) return "errLimit";
  if (status >= 500) return "errBusy";
  return "errGeneric";
}

function fmt(s: number): string {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function Interview(props: {
  contactEmail: string;
  code: string;
  maxMinutes: number;
  initialLang: Lang;
  /** true when ?lang= was in the link; otherwise the session's remembered choice may override */
  langExplicit: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("consent");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [activity, setActivity] = useState<Activity>("listening");
  const [elapsed, setElapsed] = useState(0);
  const [endedAs, setEndedAs] = useState<EndStatus>("completed");
  const [lang, setLang] = useState<Lang>(props.initialLang);
  const [device, setDevice] = useState<Device>("far");
  const [noise, setNoise] = useState<{ state: "idle" | "checking" | "done"; db?: number }>({ state: "idle" });
  const ambientRef = useRef<number | undefined>(undefined);
  const micSettingsRef = useRef<MediaTrackSettings | undefined>(undefined);
  const t: Strings = STRINGS[lang];

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const idRef = useRef<string | null>(null);
  const startRef = useRef(0);
  const maxSecRef = useRef(props.maxMinutes * 60);
  const endingRef = useRef(false);
  const mutedRef = useRef(false);
  const order = useRef<string[]>([]);
  const entries = useRef(new Map<string, Entry>());
  const outcomeRef = useRef<Outcome | null>(null);
  const closing = useRef<"none" | "farewell-pending" | "farewell-spoken">("none");
  const sentWrap = useRef(false);
  const sentEnd = useRef(false);
  const timers = useRef<{ tick?: number; save?: number; drop?: number; farewell?: number }>({});
  const rec = useRef<{ r: MediaRecorder; mime: string; buf: Blob[]; size: number; seq: number; chain: Promise<void> } | null>(null);

  // ---- transcript ----
  function ensure(itemId: string, role: Entry["role"]): Entry {
    let e = entries.current.get(itemId);
    if (!e) {
      e = { itemId, role, text: "", t: startRef.current ? Date.now() - startRef.current : 0 };
      entries.current.set(itemId, e);
      order.current.push(itemId);
    }
    return e;
  }
  function transcript(): TranscriptEntry[] {
    return order.current
      .map((id) => entries.current.get(id)!)
      .filter((e) => e.text.trim())
      .map(({ role, text, t }) => ({ role, text: text.trim(), t }));
  }

  // ---- persistence ----
  async function post(end?: EndStatus) {
    const id = idRef.current;
    if (!id) return;
    const body = JSON.stringify({ transcript: transcript(), outcome: outcomeRef.current ?? undefined, end });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(`/api/interviews/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
        if (r.ok) return;
      } catch {
        /* retry once */
      }
    }
  }

  // ---- audio recording (best effort; never blocks the interview) ----
  function startRecorder(remote: MediaStream) {
    try {
      const mic = micRef.current;
      const ctx = ctxRef.current;
      if (!mic || typeof MediaRecorder === "undefined") return;
      let stream: MediaStream = mic;
      if (ctx) {
        try {
          const dest = ctx.createMediaStreamDestination();
          ctx.createMediaStreamSource(mic).connect(dest);
          ctx.createMediaStreamSource(remote).connect(dest);
          stream = dest.stream;
        } catch {
          stream = mic; // pilot-only audio is better than none
        }
      }
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      const r = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 24_000 } : undefined);
      const state = { r, mime: r.mimeType || mime || "audio/webm", buf: [] as Blob[], size: 0, seq: 0, chain: Promise.resolve() };
      r.ondataavailable = (e) => {
        if (!e.data.size) return;
        state.buf.push(e.data);
        state.size += e.data.size;
        if (state.size >= PART_BYTES) flushAudio();
      };
      r.start(5000);
      rec.current = state;
    } catch (e) {
      console.warn("recording unavailable", e);
    }
  }
  function flushAudio() {
    const s = rec.current;
    const id = idRef.current;
    if (!s || !id || !s.buf.length) return;
    const blob = new Blob(s.buf, { type: s.mime });
    const seq = s.seq++;
    s.buf = [];
    s.size = 0;
    s.chain = s.chain.then(async () => {
      try {
        await fetch(`/api/interviews/${id}/audio?seq=${seq}`, { method: "POST", headers: { "Content-Type": s.mime }, body: blob });
      } catch {
        /* a lost part only leaves a gap in the audio */
      }
    });
  }
  async function stopRecorder() {
    const s = rec.current;
    if (!s) return;
    await new Promise<void>((resolve) => {
      if (s.r.state === "inactive") return resolve();
      s.r.onstop = () => resolve();
      try {
        s.r.requestData();
        s.r.stop();
      } catch {
        resolve();
      }
    });
    flushAudio();
    await s.chain;
  }

  // ---- ending ----
  async function endCall(status: EndStatus) {
    if (endingRef.current) return;
    endingRef.current = true;
    setPhase("ending");
    window.clearInterval(timers.current.tick);
    window.clearInterval(timers.current.save);
    window.clearTimeout(timers.current.drop);
    window.clearTimeout(timers.current.farewell);
    try {
      dcRef.current?.close();
      pcRef.current?.close();
    } catch {
      /* already closed */
    }
    await stopRecorder();
    micRef.current?.getTracks().forEach((t) => t.stop());
    ctxRef.current?.close().catch(() => {});
    await post(status);
    setEndedAs(status);
    setPhase("done");
  }

  // ---- realtime events ----
  function send(ev: Ev) {
    const dc = dcRef.current;
    if (dc?.readyState === "open") dc.send(JSON.stringify(ev));
  }

  function onEvent(ev: Ev) {
    switch (ev.type) {
      case "conversation.item.added":
      case "conversation.item.done": {
        const item = ev.item as Ev | undefined;
        if (item?.type !== "message" || (item.role !== "user" && item.role !== "assistant")) break;
        const e = ensure(item.id, item.role === "user" ? "pilot" : "interviewer");
        const t = (item.content as Ev[] | undefined)?.find((c) => typeof c.transcript === "string" && c.transcript)?.transcript;
        if (t && !e.text) e.text = t;
        break;
      }
      case "conversation.item.input_audio_transcription.completed":
        ensure(ev.item_id, "pilot").text = String(ev.transcript ?? "");
        break;
      case "response.output_audio_transcript.delta": {
        const e = ensure(ev.item_id, "interviewer");
        e.text += String(ev.delta ?? "");
        setActivity("speaking");
        break;
      }
      case "response.output_audio_transcript.done":
        ensure(ev.item_id, "interviewer").text = String(ev.transcript ?? "");
        break;
      case "input_audio_buffer.speech_started":
        setActivity("hearing");
        break;
      case "input_audio_buffer.speech_stopped":
        setActivity("thinking");
        break;
      case "output_audio_buffer.started":
        setActivity("speaking");
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        setActivity("listening");
        if (closing.current === "farewell-spoken") window.setTimeout(() => void endCall("completed"), 600);
        break;
      case "response.done":
        onResponseDone(ev.response as Ev);
        break;
      case "error":
        console.warn("realtime error", ev.error);
        break;
    }
  }

  function onResponseDone(resp: Ev) {
    const calls = ((resp?.output as Ev[]) ?? []).filter((o) => o.type === "function_call" && o.name === "record_outcome");
    if (calls.length) {
      for (const c of calls) {
        try {
          const a = JSON.parse(c.arguments || "{}");
          if (a.commitment === "yes" || a.commitment === "no" || a.commitment === "unsure") {
            outcomeRef.current = { commitment: a.commitment, email: a.email, note: a.note, profile: a.profile };
          }
        } catch {
          /* model produced bad JSON; transcript still holds the answer */
        }
        send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: c.call_id, output: JSON.stringify({ ok: true }) } });
      }
      closing.current = "farewell-pending";
      send({ type: "response.create" });
      void post(); // persist the outcome right away
      return;
    }
    if (closing.current === "farewell-pending" && resp?.status === "completed") {
      closing.current = "farewell-spoken";
      // if the audio-stopped event never arrives, don't hang forever
      timers.current.farewell = window.setTimeout(() => void endCall("completed"), 20_000);
    }
  }

  // ---- start ----
  async function start() {
    setError(null);
    const AC = window.AudioContext; // unprefixed since iOS Safari 14.5
    // created synchronously inside the tap so iOS Safari lets it run
    if (AC) {
      ctxRef.current = new AC();
      ctxRef.current.resume().catch(() => {});
    }
    const el = new Audio();
    el.autoplay = true;

    let mic: MediaStream;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
    } catch (e) {
      setError(t[micErrorKey(e)]);
      ctxRef.current?.close().catch(() => {});
      return;
    }
    micRef.current = mic;
    const applied = mic.getAudioTracks()[0]?.getSettings();
    micSettingsRef.current = applied;
    console.info("[mic] applied settings", applied);
    for (const k of ["noiseSuppression", "echoCancellation", "autoGainControl"] as const) {
      if (applied?.[k] !== true) console.warn(`[mic] ${k} was not applied by this browser/device:`, applied?.[k]);
    }
    setPhase("starting");
    endingRef.current = false;

    try {
      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      pc.ontrack = (e) => {
        el.srcObject = e.streams[0];
        void el.play().catch(() => {});
        startRecorder(e.streams[0]);
      };
      pc.addTrack(mic.getAudioTracks()[0], mic);
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onmessage = (m) => {
        try {
          onEvent(JSON.parse(m.data));
        } catch {
          /* ignore malformed event */
        }
      };
      dc.onopen = () => {
        startRef.current = Date.now();
        setPhase("live");
        send({ type: "response.create" }); // the interviewer speaks first
        timers.current.tick = window.setInterval(tick, 1000);
        timers.current.save = window.setInterval(() => void post(), 30_000);
      };
      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        if (endingRef.current) return;
        window.clearTimeout(timers.current.drop);
        if (s === "failed" || s === "closed") void endCall("dropped");
        else if (s === "disconnected") timers.current.drop = window.setTimeout(() => void endCall("dropped"), 8000);
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const r = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sdp: offer.sdp,
          consent: true,
          consentVersion: CONSENT_VERSION,
          code: props.code,
          lang,
          device,
          mic: micSettingsRef.current,
          ambientDb: ambientRef.current,
        }),
      });
      const data = (await r.json().catch(() => ({}))) as { id?: string; sdp?: string; maxSeconds?: number; error?: string };
      if (!r.ok || !data.id || !data.sdp) throw new Error(sessionErrorKey(r.status));
      idRef.current = data.id;
      if (data.maxSeconds) maxSecRef.current = data.maxSeconds;
      await pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
    } catch (e) {
      // nothing was recorded server-side unless an id exists
      const hadId = Boolean(idRef.current);
      pcRef.current?.close();
      mic.getTracks().forEach((t) => t.stop());
      ctxRef.current?.close().catch(() => {});
      if (hadId) {
        void endCall("dropped");
      } else {
        setPhase("consent");
        const key = e instanceof Error && e.message.startsWith("err") ? (e.message as ErrKey) : "errGeneric";
        setError(t[key]);
      }
    }
  }

  function tick() {
    const sec = Math.floor((Date.now() - startRef.current) / 1000);
    setElapsed(sec);
    const max = maxSecRef.current;
    if (!sentWrap.current && sec >= Math.max(60, max - 8 * 60)) {
      sentWrap.current = true;
      send({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: "[TIME CHECK] About 8 minutes remain. Wrap up: finish the current thread, then move to the close within a minute or two." }] } });
    }
    if (!sentEnd.current && sec >= Math.max(90, max - 3 * 60)) {
      sentEnd.current = true;
      send({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: "[TIME CHECK] Out of time. End now: go straight to the closing ask." }] } });
    }
    if (sec >= max) void endCall("capped");
  }

  function toggleMute() {
    const next = !mutedRef.current;
    mutedRef.current = next;
    micRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
  }

  // tab closed mid-interview: save what we have
  useEffect(() => {
    const onHide = () => {
      if (!idRef.current || endingRef.current) return;
      const body = JSON.stringify({ transcript: transcript(), outcome: outcomeRef.current ?? undefined, end: "dropped" });
      navigator.sendBeacon(`/api/interviews/${idRef.current}`, new Blob([body], { type: "application/json" }));
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- language ----
  useEffect(() => {
    if (props.langExplicit) return;
    try {
      const s = sessionStorage.getItem("lang");
      if (s === "he" || s === "en") setLang(s);
    } catch {
      /* storage blocked: stay with the default */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dirOf(lang);
  }, [lang]);
  // phone held near the face vs laptop/iPad on a table: a coarse pointer on a narrow screen is a phone
  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 600) setDevice("near");
  }, []);

  function pickLang(next: Lang) {
    setLang(next);
    setError(null);
    try {
      sessionStorage.setItem("lang", next);
    } catch {
      /* ignore */
    }
    const u = new URL(window.location.href);
    u.searchParams.set("lang", next);
    window.history.replaceState(null, "", u);
  }

  /** Measures ambient power for NOISE_CHECK_MS with AGC/NS off (they would hide the noise we want to see). */
  async function runNoiseCheck() {
    if (noise.state === "checking") return;
    const AC = window.AudioContext;
    if (!AC) return;
    setError(null);
    setNoise({ state: "checking" });
    const ctx = new AC();
    ctx.resume().catch(() => {});
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 1 } },
      });
      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Float32Array(an.fftSize);
      let power = 0;
      let frames = 0;
      const end = Date.now() + NOISE_CHECK_MS;
      while (Date.now() < end) {
        await new Promise((r) => setTimeout(r, 100));
        an.getFloatTimeDomainData(buf);
        let s = 0;
        for (const v of buf) s += v * v;
        power += s / buf.length;
        frames++;
      }
      const db = Math.round(10 * Math.log10(Math.max(power / Math.max(frames, 1), 1e-12)));
      ambientRef.current = db;
      setNoise({ state: "done", db });
    } catch (e) {
      setNoise({ state: "idle" });
      setError(t[micErrorKey(e)]);
    } finally {
      stream?.getTracks().forEach((tr) => tr.stop());
      ctx.close().catch(() => {});
    }
  }

  // dir on a display:contents wrapper: inherited by everything below, no layout box of its own
  const wrap = (n: ReactNode) => (
    <div dir={dirOf(lang)} lang={lang} style={{ display: "contents" }}>
      {n}
    </div>
  );
  const ctx = { contactEmail: props.contactEmail, maxMinutes: props.maxMinutes };
  const emailNode = props.contactEmail ? (
    <a href={`mailto:${props.contactEmail}`} dir="ltr">
      {props.contactEmail}
    </a>
  ) : (
    t.deleteNoEmail
  );

  // ---- UI ----
  if (phase === "consent") {
    const noiseMsg =
      noise.state === "checking"
        ? t.noiseChecking
        : noise.state === "done" && noise.db !== undefined
          ? noise.db < SILENT_DBFS
            ? t.noiseSilent
            : noise.db > NOISY_DBFS
              ? t.noiseLoud(noise.db)
              : t.noiseQuiet(noise.db)
          : null;
    const noiseCls = noise.state === "done" && noise.db !== undefined && noise.db >= SILENT_DBFS && noise.db <= NOISY_DBFS ? "notice good" : "notice";
    return wrap(
      <>
        <div role="group" aria-label="Language / שפה" className="row" style={{ marginBottom: 8 }}>
          <button type="button" className={lang === "en" ? "" : "secondary"} aria-pressed={lang === "en"} lang="en" dir="ltr" onClick={() => pickLang("en")}>
            English
          </button>
          <button type="button" className={lang === "he" ? "" : "secondary"} aria-pressed={lang === "he"} lang="he" dir="rtl" onClick={() => pickLang("he")}>
            עברית
          </button>
        </div>

        <h1>{t.pageTitle}</h1>
        <p className="muted">{t.intro(ctx)}</p>

        <div className="card">
          <strong>{t.readFirst}</strong>
          <ul>
            {t.rules.map((rule, i) => (
              <li key={i}>{rule(ctx)}</li>
            ))}
          </ul>
        </div>

        <fieldset className="card" style={{ border: "1px solid var(--line)" }}>
          <legend>{t.deviceLabel}</legend>
          <label className="check" style={{ margin: "6px 0" }}>
            <input type="radio" name="device" checked={device === "near"} onChange={() => setDevice("near")} />
            <span>{t.deviceNear}</span>
          </label>
          <label className="check" style={{ margin: "6px 0" }}>
            <input type="radio" name="device" checked={device === "far"} onChange={() => setDevice("far")} />
            <span>{t.deviceFar}</span>
          </label>
          <button type="button" className="secondary" disabled={noise.state === "checking"} onClick={() => void runNoiseCheck()}>
            {t.noiseCheck}
          </button>
          {noiseMsg && <div className={noiseCls} role="status">{noiseMsg}</div>}
        </fieldset>

        <label className="check">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>{t.agree}</span>
        </label>

        {error && <div className="notice bad">{error}</div>}

        <button className="big" disabled={!agreed || noise.state === "checking"} onClick={() => void start()}>
          {t.start}
        </button>
        <p className="muted" style={{ fontSize: ".9rem" }}>
          {t.micNote}
        </p>
      </>,
    );
  }

  if (phase === "starting") {
    return wrap(
      <div className="live" style={{ display: "flex", flexDirection: "column" }}>
        <div className="orb" />
        <div className="status">{t.connecting}</div>
      </div>,
    );
  }

  if (phase === "live") {
    const label = muted ? t.muted : { listening: t.listening, hearing: t.hearing, thinking: t.thinking, speaking: t.speaking }[activity];
    const cls = muted ? "muted" : activity;
    return wrap(
      <div className="live" style={{ display: "flex", flexDirection: "column" }}>
        <div>
          <div className={`orb ${cls}`} aria-hidden />
          <div className="status" role="status" aria-live="polite">
            {label}
          </div>
          <div className="timer" dir="ltr">
            {fmt(elapsed)} / {fmt(maxSecRef.current)}
          </div>
        </div>
        <div className="row" style={{ width: "100%" }}>
          <button className="secondary" onClick={toggleMute}>
            {muted ? t.unmute : t.mute}
          </button>
          <button className="danger" onClick={() => void endCall("completed")}>
            {t.end}
          </button>
        </div>
      </div>,
    );
  }

  if (phase === "ending") {
    return wrap(
      <div className="live" style={{ display: "flex", flexDirection: "column" }}>
        <div className="orb" />
        <div className="status">{t.saving}</div>
        <p className="muted">{t.keepOpen}</p>
      </div>,
    );
  }

  return wrap(
    <>
      <h1>{endedAs === "completed" ? t.thanks : t.ended}</h1>
      {endedAs === "dropped" && <div className="notice">{t.dropped}</div>}
      {endedAs === "capped" && <div className="notice">{t.capped}</div>}
      <p>{t.saved}</p>
      <p className="muted">{t.deleteTo(emailNode)}</p>
    </>,
  );
}
