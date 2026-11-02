# Pilot interviews

A tiny Next.js app on Vercel. A pilot opens a shareable link, agrees to be recorded, and an AI voice interviewer
(OpenAI Realtime, `gpt-realtime-2.1`) runs the customer-discovery interview from `docs/pilot-interview-kit.md` using
The Mom Test: past behaviour only, no pitch, the pilot talks ~80% of the time. Kanaf is first named at the closing ask
(TestFlight build + 10-minute follow-up). Transcript (both sides, timestamped) and audio are stored per interview;
`/admin` lets the owner read, play, and export them in the kit's notes template for `docs/CUSTOMER.md`.

Lives in the Kanaf repo under `web/interviews/`, copied from the standalone `~/dev/pilot-interviews` repo at commit
`0af81df2b331cbd1d93258c6f3d42e5eb241c2f9` (2026-11-01); that repo is retired. Live at `https://openefb-interviews.vercel.app`
on the Vercel Hobby plan. The only cron is daily (`vercel.json`, 06:00 UTC), which is the Hobby limit. This site is not part of the
iPad app and the app never calls it. See `web/README.md`.

## How it works

```
browser ── POST /api/session {sdp offer, consent, invite code} ──▶ server ── POST /v1/realtime/calls ──▶ OpenAI
        ◀─ {id, sdp answer} ──────────────────────────────────────┘   (API key + interviewer prompt stay server-side)
browser ◀══ WebRTC audio + "oai-events" data channel ══▶ OpenAI
browser ── POST /api/interviews/:id (transcript, outcome, end) / …/audio?seq=N (audio parts) ──▶ Vercel Blob
```

- The server uses OpenAI's documented *unified interface* for WebRTC (`POST /v1/realtime/calls` with the SDP + session
  config). It is used instead of minting an ephemeral client secret because the server then owns consent, limits, the
  interviewer instructions, and the call id (so it can hang up). `OPENAI_API_KEY` never reaches the browser.
- Input transcription is on (`gpt-4o-mini-transcribe`). The interviewer ends with a `record_outcome` function call
  (yes / no / unsure, optional email, pilot profile).
- Audio: the browser records the mic + interviewer mix with `MediaRecorder` and uploads ~150 KB parts as it goes (Vercel
  request bodies are capped at 4.5 MB), so a dropped call still keeps most of the audio. Best effort: if recording fails the
  interview continues and the transcript is still saved.

## Local development

```bash
npm install
cp .env.example .env.local      # set OPENAI_API_KEY and ADMIN_PASSWORD at minimum
npm run dev                     # http://localhost:3000
```

With no Blob credentials, storage falls back to `./.data/` (git-ignored). On Vercel, a missing store is an error, never
silent. Microphone access works on `localhost` and HTTPS only.

## Environment variables

| Var | Required | Meaning |
|---|---|---|
| `OPENAI_API_KEY` | yes | Server-only. |
| `ADMIN_PASSWORD` | yes | HTTP Basic password for `/admin` and `/api/admin/*` (username ignored). Fails closed if unset. Also salts the hashed IPs. |
| `BLOB_READ_WRITE_TOKEN` | prod | Vercel Blob store token. Create the store as **private**. (`BLOB_STORE_ID` + OIDC also works.) |
| `INVITE_CODE` | no | If set, links must be `/?c=<code>`; checked server-side. |
| `DAILY_INTERVIEW_CAP` | no | Interviews started per UTC day, all visitors (default 20). |
| `IP_DAILY_CAP` | no | Interviews per hashed IP per UTC day (default 3). |
| `MAX_SESSION_MINUTES` | no | Hard cap (default 25). |
| `REALTIME_MODEL` | no | Default `gpt-realtime-2.1` (`gpt-realtime` is deprecated). |
| `REALTIME_VOICE` | no | Default `marin`. |
| `TRANSCRIBE_MODEL` | no | Default `gpt-4o-mini-transcribe`. |
| `REALTIME_VOICE_HE`, `TRANSCRIBE_MODEL_HE` | no | Hebrew-only overrides of the voice and transcription model (default to the English values). |
| `NOISE_REDUCTION` | no | `auto` (default: the pilot's device choice picks it), `near_field`, `far_field` or `off`. See "Languages and noise". |
| `NOISE_REDUCTION_STRENGTH` | no | 0..1, default 1. |
| `TURN_DETECTION` | no | `semantic_vad` (default) or `server_vad`. |
| `VAD_EAGERNESS` | no | `semantic_vad` only: `low` (default), `medium`, `high`, `auto`. |
| `VAD_THRESHOLD`, `VAD_SILENCE_MS`, `VAD_PREFIX_MS` | no | `server_vad` only: defaults 0.7, 1000, 300 (API defaults 0.5, 500, 300). |
| `VAD_INTERRUPT_RESPONSE` | no | Default `true`; `false` stops detected speech from cutting off the interviewer. |
| `SUMMARY_MODEL` | no | e.g. `gpt-4.1-mini`. If set, each finished interview is auto-summarised into the notes template. |
| `CRON_SECRET` | prod | Random string; Vercel Cron sends it as a Bearer token to `/api/cron/reap`. |
| `CONTACT_EMAIL` | recommended | Shown on the consent screen (where to send deletion requests). |

## Languages and noise

**Hebrew.** The landing page has an English / עברית switch (remembered for the browser session), and links can pick the
language: `/?lang=he` or `/?lang=he&c=<INVITE_CODE>`. Hebrew renders the whole UI right-to-left (`dir="rtl"`, Latin terms
such as VFR or an email stay left-to-right), the interviewer speaks Israeli Hebrew with English aviation terms
(`src/lib/interviewer.ts`, kit in `docs/pilot-interview-kit-he.md`), and transcription is pinned to `language: "he"` with
a prompt listing the aviation terms. Voices: the Realtime API documents no per-language voice list; `marin` and `cedar`
are its recommended voices, so Hebrew defaults to `REALTIME_VOICE_HE` or `REALTIME_VOICE` (`marin`). Audition `cedar` and
others with a real Hebrew call before relying on one. `/admin` shows the language per interview and renders Hebrew
transcripts right-to-left; the exported `.md` marks Hebrew lines with a leading RLM.

**Noise.** Three layers, all applied per call:
1. *Browser*: `getUserMedia` asks for `echoCancellation`, `noiseSuppression`, `autoGainControl`, mono and 48 kHz. These
   are requests; the applied values are read back from `track.getSettings()`, logged to the console (`[mic]`), warned about
   if not applied, and stored on the interview (admin shows `mic NS/EC/AGC`).
2. *Server*: Realtime `audio.input.noise_reduction` (`near_field` for headphones or a phone near the face, `far_field` for a
   laptop/iPad on a table; the pilot chooses on the consent screen, phones default to near) with `strength`.
   `NOISE_REDUCTION` can force one or `off`.
3. *Turn detection*: `semantic_vad` with `eagerness: low` by default. For very noisy callers try `TURN_DETECTION=server_vad`
   with `VAD_THRESHOLD=0.7-0.8` and `VAD_SILENCE_MS=1000-1200`, and `VAD_INTERRUPT_RESPONSE=false` so noise cannot cut the
   interviewer off. `semantic_vad` has no threshold knob.

An optional **noise check** button on the consent screen measures 3 s of ambient power (AGC and suppression off) and
suggests headphones or a quieter spot above -45 dBFS. The threshold is a heuristic constant in `Interview.tsx`; tune it
with real calls. The measured value is stored with the interview.

## Deploy to Vercel

The production project already exists: `openefb-interviews` (`https://openefb-interviews.vercel.app`), git-connected to `omercnet/openefb` with Root Directory `web/interviews` and production branch `main`. A push to `main` deploys it, unless the project's Ignored Build Step skips the build (see "Vercel build-skip rule" in `web/README.md`). The steps below create a new project from scratch.

```bash
cd web/interviews
npx vercel login
npx vercel link        # Root Directory: web/interviews (set it in the project settings if link doesn't ask)
npx vercel blob create-store pilot-interviews --access private --yes   # adds BLOB_READ_WRITE_TOKEN to the project
npx vercel env add OPENAI_API_KEY production
npx vercel env add ADMIN_PASSWORD production
npx vercel env add CRON_SECRET production
npx vercel env add INVITE_CODE production            # optional
npx vercel env add CONTACT_EMAIL production
npx vercel env add SUMMARY_MODEL production          # optional
npx vercel --prod
```

Share `https://<your-domain>/?c=<INVITE_CODE>`. Use a fresh `INVITE_CODE` per channel if you want to tell recruiting
sources apart.

## Reviewing and exporting

Open `/admin` (any username, password = `ADMIN_PASSWORD`). The list shows date, duration, pilot profile, commitment and
status. An interview page has the audio player, the transcript, and the notes in the kit's template (**Open .md** →
paste into `docs/CUSTOMER.md`). The "confirms/contradicts" row is only filled in when `SUMMARY_MODEL` is set. The
**Delete** button removes the transcript, audio and markers for a pilot's deletion request.

## Safeguards (all server-side)

- **Consent**: `/api/session` returns 400 unless the request carries `consent: true` for the current consent version;
  the UI only sends it after an unticked-by-default checkbox + Start. No consent → no OpenAI call, no recording.
- **Per-IP/day and daily caps**: reservation markers in storage, checked before any OpenAI call (429).
- **Invite code**: constant-time check (403).
- **Session cap**: the client ends the call at `MAX_SESSION_MINUTES` and the server hangs it up via
  `/v1/realtime/calls/{id}/hangup`. A daily cron (`vercel.json`, daily so it works on the Hobby plan) hangs up any call
  that was never ended. A tampered client could therefore keep a call open up to OpenAI's own 60-minute session limit, bounded by the IP/daily caps.
- Limits count markers without a transaction, so two simultaneous starts can overshoot a cap by one.

## Cost per interview

Audio is billed per token: input $32 / 1M, cached input $0.40 / 1M, output $64 / 1M (gpt-realtime-2.1 model page).
**Estimate, not measured:** a 20-minute interview with the pilot speaking ~80% of the time is on the order of
**$0.50–$2**, plus fractions of a cent for transcription and the optional summary. Check the OpenAI usage dashboard
after the first few interviews and adjust `DAILY_INTERVIEW_CAP` accordingly (20 interviews/day ≈ $10–40/day worst case).

## Known limits

- Live voice, iOS Safari behaviour, and audio-part concatenation on Safari (`audio/mp4`) need a real-device run with an OpenAI key.
- No pilot accounts; the unguessable interview id from `/api/session` is the only credential for saving that interview.
