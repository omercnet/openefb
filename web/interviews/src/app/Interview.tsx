"use client";

import { useEffect, useRef, useState } from "react";
import { CONSENT_VERSION, type Outcome, type TranscriptEntry } from "@/lib/types";

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

function micMessage(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access was blocked. Allow the microphone for this site (on iPhone: the aA menu in Safari > Website Settings > Microphone, or Settings > Safari > Microphone), then tap Start again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found on this device.";
  return "Couldn't open the microphone. Check that no other app is using it, then try again.";
}

function fmt(s: number): string {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function Interview(props: {
  interviewer: string;
  contactEmail: string;
  code: string;
  maxMinutes: number;
}) {
  const [phase, setPhase] = useState<Phase>("consent");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [activity, setActivity] = useState<Activity>("listening");
  const [elapsed, setElapsed] = useState(0);
  const [endedAs, setEndedAs] = useState<EndStatus>("completed");

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
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      setError(micMessage(e));
      ctxRef.current?.close().catch(() => {});
      return;
    }
    micRef.current = mic;
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
        body: JSON.stringify({ sdp: offer.sdp, consent: true, consentVersion: CONSENT_VERSION, code: props.code }),
      });
      const data = (await r.json().catch(() => ({}))) as { id?: string; sdp?: string; maxSeconds?: number; error?: string };
      if (!r.ok || !data.id || !data.sdp) throw new Error(data.error || "Could not start the interview.");
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
        setError(e instanceof Error ? e.message : "Could not start the interview.");
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

  // ---- UI ----
  if (phase === "consent") {
    return (
      <>
        <h1>A 20-minute chat about flying with your iPad</h1>
        <p className="muted">
          For VFR pilots. No sales pitch: {props.interviewer} just wants to hear about your last few flights.
        </p>

        <div className="card">
          <strong>Before we start, please read this</strong>
          <ul>
            <li>
              <b>Who&apos;s asking:</b> {props.interviewer}. You&apos;ll talk with an <b>AI voice interviewer</b> (not a person), running on OpenAI&apos;s speech technology, so your voice is processed by OpenAI.
            </li>
            <li>
              <b>What&apos;s recorded:</b> the conversation is <b>audio-recorded and transcribed</b>. If you choose to share an email at the end, that is stored too.
            </li>
            <li>
              <b>How it&apos;s used:</b> to study how pilots use iPads in the cockpit. Only {props.interviewer} can see it. Short quotes may be used in notes without your name.
            </li>
            <li>
              <b>Delete or stop:</b> you can end any time with the End button. To have your interview deleted, email{" "}
              {props.contactEmail ? <a href={`mailto:${props.contactEmail}`}>{props.contactEmail}</a> : "the person who sent you this link"}
              .
            </li>
            <li>
              Takes about 20 minutes (stops at {props.maxMinutes}). Please don&apos;t do this while flying. Headphones and a quiet spot help.
            </li>
          </ul>
        </div>

        <label className="check">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>I&apos;m 18 or older, and I agree to be recorded and transcribed as described above.</span>
        </label>

        {error && <div className="notice bad">{error}</div>}

        <button className="big" disabled={!agreed} onClick={() => void start()}>
          Start interview
        </button>
        <p className="muted" style={{ fontSize: ".9rem" }}>
          Your browser will ask to use the microphone. Nothing is recorded until you tap Start.
        </p>
      </>
    );
  }

  if (phase === "starting") {
    return (
      <div className="live" style={{ display: "flex", flexDirection: "column" }}>
        <div className="orb" />
        <div className="status">Connecting…</div>
      </div>
    );
  }

  if (phase === "live") {
    const label = muted
      ? "Muted"
      : { listening: "Listening", hearing: "Hearing you", thinking: "Thinking", speaking: "Interviewer speaking" }[activity];
    const cls = muted ? "muted" : activity;
    return (
      <div className="live" style={{ display: "flex", flexDirection: "column" }}>
        <div>
          <div className={`orb ${cls}`} aria-hidden />
          <div className="status" role="status" aria-live="polite">
            {label}
          </div>
          <div className="timer">
            {fmt(elapsed)} / {fmt(maxSecRef.current)}
          </div>
        </div>
        <div className="row" style={{ width: "100%" }}>
          <button className="secondary" onClick={toggleMute}>
            {muted ? "Unmute" : "Mute"}
          </button>
          <button className="danger" onClick={() => void endCall("completed")}>
            End interview
          </button>
        </div>
      </div>
    );
  }

  if (phase === "ending") {
    return (
      <div className="live" style={{ display: "flex", flexDirection: "column" }}>
        <div className="orb" />
        <div className="status">Saving your interview…</div>
        <p className="muted">Please keep this page open for a moment.</p>
      </div>
    );
  }

  return (
    <>
      <h1>{endedAs === "completed" ? "Thank you!" : "Interview ended"}</h1>
      {endedAs === "dropped" && (
        <div className="notice">The connection dropped. What we captured so far has been saved, so you don&apos;t need to do anything.</div>
      )}
      {endedAs === "capped" && <div className="notice">We reached the time limit. What we captured has been saved.</div>}
      <p>Your interview has been saved. You can close this page.</p>
      <p className="muted">
        To have it deleted, email {props.contactEmail ? <a href={`mailto:${props.contactEmail}`}>{props.contactEmail}</a> : "the person who sent you this link"}.
      </p>
    </>
  );
}
