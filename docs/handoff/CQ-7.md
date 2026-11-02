# CQ-7: Reliability and security of every network dependency (dashboard T27)

Use the `release-it` skill (.claude/skills/release-it/SKILL.md): this is Phase 7 of the code-quality journey. Its tracker,
docs/IMPROVE-CODE-QUALITY-PLAN.md, is being created by the CQ-1 agent; add your row's status when it exists. Also do a
security review: this company treats authz gaps, injection, SSRF and secret handling as must-flag.

## Scope
**A. Our web services**
In web/; no other agent edits it now, so fix issues here directly.
- **web/notam-relay** (Cloudflare Worker, live at https://openefb-notam-relay.omerc.workers.dev):
  - scrape timeouts, retry policy, and backoff when IAA errors or blocks;
  - KV write budget (1000/day free);
  - what the app sees when the feed is stale: `/health`, and cache headers;
  - the `/run` auth (Bearer RUN_SECRET): use a constant-time compare;
  - input parsing robustness against hostile or garbled HTML;
  - history store growth.
- **web/charts:**
  - the publish script's safety: it can never unpublish, `--approve` gates publishing, checksums;
  - CORS;
  - r2.dev rate limits (recommend the custom-domain plan);
  - integrity: the app verifies the SHA-256 of every file.
- **web/interviews** (Next.js on Vercel, live):
  - admin Basic auth (`ADMIN_PASSWORD` fails closed?) and timing-safe comparison;
  - the invite code;
  - rate limits and the daily caps (`DAILY_INTERVIEW_CAP`, `IP_DAILY_CAP`) and that they can't be bypassed;
  - OpenAI key exposure: it must never reach the client;
  - Blob privacy: interview audio and transcripts are personal data, so the store must be private and its URLs not
    guessable;
  - the cron auth (`CRON_SECRET`);
  - input validation on the upload routes (size limits, content type, path traversal in the ids);
  - the consent flow records consent before any audio;
  - data retention matches what the consent text says.

**B. App integration points**
Read-only audit now; other agents are editing app code. Covering aviationweather.gov, the FAA TFR, NOTAM API and d-TPP,
the tile hosts, the NOTAM relay client, the chart and diagram pack downloads, and Apple Foundation Models. For each:
- the timeout;
- retries and backoff;
- what the pilot sees on failure;
- the staleness badge;
- the cache fallback;
- whether a slow dependency can block the main thread or the map.

## Output
1. `docs/RELIABILITY.md` from the skill's artifact template: integration-point inventory, stability patterns present
   and missing, failure modes and what the pilot sees, a 0–10 score, and prioritized fixes.
2. A **security findings** section, in RELIABILITY.md or docs/SECURITY.md: each finding with severity, evidence
   (file:line), and the fix. **Don't invent CVSS scores.**
3. **Fix** the web/ findings now: tests green, `npm test` / lint / build per package. Redeploy the relay with
   `npx wrangler deploy` from web/notam-relay (wrangler is logged in), and check `/health` afterwards. **Don't** deploy
   interviews to production yourself; it deploys when the integrator pushes. Note anything that needs an env change in
   Vercel or Cloudflare for the owner.
4. File app-side fixes as beads (parent efb-zfm, the review backlog) with priority by risk. Don't edit app Swift files;
   five agents are editing them.

Close nothing; don't commit. Report the scores, the top findings and what you fixed.

Record progress on the Paseo dashboard as you work:
- at each new stage: cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticket update T27 --stage <stage>
- between stages:    cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticker set "<what you are doing now>"
Use the stages Build, Review, Fixes and Verify. Never end your turn on an intention.
