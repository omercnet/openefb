# Handoff: voice interview app for VFR pilots

## Task
Build and deploy a tiny web app on Vercel. A pilot opens a shareable link, and an AI interviewer using OpenAI's Realtime
voice model (gpt-realtime) conducts the customer-discovery interview in docs/pilot-interview-kit.md by voice. Each
interview's transcript (and audio, if feasible) is recorded so the owner can review the responses. The owner wants to
spread the link to pilots.

## Context
- Kanaf is a free, open-source iPad VFR EFB (separate repo, ~/dev/openefb). Its product assumptions are in
  docs/openefb-customer-hypotheses.md:
  - the anchor job is in-flight awareness;
  - trust is the worst-served dimension;
  - the failure mode is the "Little Hire", i.e. every flight;
  - panel GPS is a key alternative.
  These are unvalidated. The interviews exist to confirm or kill them.
- docs/pilot-interview-kit.md is the source of truth for the interview: recruiting post, opening, 12 questions grouped by
  theme, deflection rules, the closing ask, and a per-interview notes template.
- Method: "The Mom Test". Ask about the pilot's real past flights, never pitch Kanaf, never ask hypotheticals ("would you
  use…"), dig for specifics ("tell me about the last time…"), and let the pilot talk ~80% of the time.

## Decisions (made by the owner/orchestrator; keep unless you find a hard blocker)
- Stack: Next.js (App Router, TypeScript) on Vercel.
- Voice: OpenAI Realtime API from the browser over WebRTC, model `gpt-realtime` (check the current model id and the
  ephemeral-key endpoint in OpenAI's live docs before coding; don't rely on memory).
  - A server route mints a short-lived client secret; the OpenAI API key never reaches the browser.
- The interviewer is an AI voice with the kit encoded as its instructions:
  - follow the question order loosely;
  - ask one question at a time;
  - follow up on specifics, and deflect compliments, generics and feature ideas the way the kit says;
  - keep to about 20 minutes;
  - close with the kit's ask (try a TestFlight build on one real flight, plus a 10-minute follow-up), recording the answer
    and an optional contact email.
- Recording: store the full transcript of both sides (input audio transcription on) per interview with timestamps.
  - Also store audio if it's simple: e.g. record the mixed stream client-side with MediaRecorder and upload at the end.
  - Storage: Vercel Blob or Vercel Postgres/Neon. Pick the simplest that works.
- Consent first: before the mic turns on, show who's asking, that the conversation is recorded and transcribed, how it's
  used, and how to request deletion. The pilot must actively agree. No consent means no recording.
- Abuse and cost control, because this is a public link with no login:
  - hard session cap (~25 min);
  - per-IP/day rate limit;
  - a server-side daily interview cap via env;
  - optionally an invite code in the link (`/?c=...`) checked server-side.
- Owner review: a password-protected `/admin` (password from env) listing interviews with:
  - date, duration, pilot profile answers and the commitment (yes/no);
  - transcript view, and audio playback if stored;
  - export of each interview as markdown in the kit's notes-template format, so results can be pasted into Kanaf's
    docs/CUSTOMER.md. An optional automatic summary into that template with an OpenAI text model after each interview is a
    nice-to-have.
- Mobile-first UI (most pilots open links on phones). One big "Start interview" button, a live "listening / speaking"
  indicator, mute and end buttons, and graceful handling of denied mic permission and dropped connections (save what was
  captured).

## Acceptance criteria
- [ ] Runs locally (`npm run dev`) with only `OPENAI_API_KEY` + storage env vars set. A `.env.example` documents all vars.
- [ ] A full voice interview works end to end in a desktop browser and on iOS Safari. Test it yourself with real speech
      if you can, at least a short session.
- [ ] Consent gate, session cap, rate limit and daily cap enforced server-side.
- [ ] Transcript (and audio if implemented) saved per interview; /admin lists, shows and exports it in the template.
- [ ] Deployed to Vercel with a production URL. If you lack Vercel or OpenAI credentials, stop at a deploy-ready state and
      print the exact commands and env vars the owner must run or set (`npx vercel login`, `npx vercel link`,
      `npx vercel env add …`, `npx vercel --prod`).
- [ ] README: what it is, local dev, env vars, deploy, how to review and export interviews, cost per interview estimate.

## Constraints
- Never expose the OpenAI API key client-side. No secrets in git.
- Don't pitch Kanaf in the interview. The pilot may learn what it's for only at the closing ask.
- Keep it tiny: no auth system for pilots, no CMS. One repo, this directory.
- The Vercel CLI isn't installed globally; use `npx vercel`. The owner must authenticate Vercel and supply OPENAI_API_KEY.
  Don't guess or reuse credentials from elsewhere on the machine.
- Commit your work in small commits on `main` in this repo (commits are SSH-signed via 1Password; if signing prompts or
  fails, stop and report).
