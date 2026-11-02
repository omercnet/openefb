# WEB-2: Pilot interviews: Hebrew version and better background-noise suppression (dashboard ticket T12)

The app is `web/interviews/` (Next.js 16, OpenAI Realtime over WebRTC). It's live at https://openefb-interviews.vercel.app
on Vercel Hobby, git-connected to omercnet/openefb with root `web/interviews`. Read its README and
docs/pilot-interview-kit.md first. The owner ran a test interview and asked for:

## 1. Hebrew version
- **Language choice** on the landing page (English / עברית), remembered for the session, and also selectable by link
  (`?lang=he`) so invites can go out already in Hebrew. The invite code (`?c=`) keeps working alongside it.
- **Full Hebrew UI**, right-to-left: consent text, buttons, status, errors and the end screen. Use a proper `dir="rtl"`
  layout. Check that mixed Hebrew/English (aviation terms like VFR, METAR, ATC, CVFR, callsigns, numbers) renders
  correctly in both directions.
- **Hebrew interviewer:**
  - Translate the interview kit's questions into natural spoken Israeli Hebrew, as a pilot would say them, not a literal
    translation. Keep standard aviation terms in English where Israeli pilots say them in English.
  - Put the Hebrew kit in docs/pilot-interview-kit-he.md, and make the instructions select the language.
  - Pick a voice that sounds natural in Hebrew; check what the current Realtime voices support.
  - Set transcription to Hebrew (`language: "he"`), so transcripts aren't mangled.
- **Admin:** show the interview language, and render Hebrew transcripts and exports right-to-left.

## 2. Background-noise suppression
The owner found it weak; pilots will call from cars, hangars, airfields and maybe aircraft. Check the current OpenAI
Realtime docs before choosing parameters; don't guess names.
- **Server side:**
  - Realtime input noise reduction, `input_audio_noise_reduction` / `noise_reduction` with `near_field` or `far_field`
    as the current API names it. Choose by device: phone held near the face → near_field; laptop/iPad on a table →
    far_field. Let the user pick, or detect it.
  - Turn detection tuned for noise: e.g. `semantic_vad` with lower eagerness, or `server_vad` with a higher threshold
    and longer silence, so noise doesn't trigger turns or interrupt the interviewer.
- **Client side:** getUserMedia constraints `noiseSuppression`, `echoCancellation` and `autoGainControl`, set on, plus
  a mono channel and a sensible sample rate. Check they actually apply (`track.getSettings()`) and log them.
- **Optional:** a short "noise check" before starting, which measures ambient level for 3 s and suggests headphones or
  a quieter spot if it's high.
- Make the settings configurable through env with sane defaults, and document them in the README.

## Verify
- `npm ci && npm run build` and the existing checks.
- Run it locally with a real mic if possible, and screenshot the Hebrew landing, consent and interview screens and the
  admin view with a Hebrew transcript (use a short local test).
- **Deploy a Vercel _preview_** for the owner to test: `npx vercel deploy` from the repo root, where `.vercelignore`
  limits the upload to web/interviews, and the project is already linked at the root `.vercel/`. Preview env has
  OPENAI_API_KEY, ADMIN_PASSWORD and Blob; it has no INVITE_CODE, so preview is open. **Don't deploy to production.**
  The integrator ships to production by committing and pushing.
- Report the preview URL.

You own web/interviews/** and docs/pilot-interview-kit-he.md. Don't edit anything else; other agents are working in the
iOS app and docs/research. No git commits. Never end your turn on an intention.
