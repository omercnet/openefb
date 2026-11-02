# web/: everything server-side

| Folder | What | Runs on | Why there |
|---|---|---|---|
| `interviews/` | Pilot interviews (Next.js 16, OpenAI realtime, daily reap cron) | **Vercel Hobby** | daily cron and small Blob use fit the free plan |
| `notam-relay/` | Israel NOTAM relay: scrapes IAA every 15 min, serves `notams.json` | **Cloudflare Worker** (Cron Trigger + KV) | Hobby crons run once a day at most |
| `charts/` | Chart pack hosting (official CAAI CVFR MBTiles, Israel data packs) + publish script | **Cloudflare R2** | R2 egress is free; Blob's 10 GB/month transfer is ~50 pack downloads |

Each folder has its own `package.json` and lockfile (no workspace tooling) and its own README with details.

## Accounts
Vercel (Hobby, personal non-commercial use only) and Cloudflare (free; R2 needs a payment method on file but the free tier costs 0).

## What is deployed (checked 2026-11-02)

| Piece | Where | State |
|---|---|---|
| `notam-relay/` | `https://openefb-notam-relay.omerc.workers.dev` (`/notams.json`, `/health`, `POST /run`) | Live. KV namespace `NOTAM_KV` is bound in `wrangler.toml`; the `*/15` Cron Trigger runs; `/health` returned 200 with 125 rows. The app's built-in default feed URL is this one (`IsraelNotamService.defaultFeedURL`); the `israelNotamFeedURL` default overrides it. |
| `charts/` | R2 bucket `openefb-charts`, public dev URL `https://pub-cdfb51548498487fa9fdb9794192c8ef.r2.dev` | Live, with CORS from `cors.json`. Published: `israel-cvfr` (latest edition 2025-02) and `il-diagrams` (latest 2026-08b). The app's built-in base URL is this one (`IsraelChartConfig.defaultBaseURL`); the `israelChartBaseURL` default overrides it. The dev URL is rate-limited: attach a custom domain before pilots depend on it. |
| `interviews/` | Vercel project `openefb-interviews`, `https://openefb-interviews.vercel.app` | Live. Git-connected to `omercnet/openefb` (production branch `main`) with Root Directory `web/interviews`, so a push to `main` deploys it. |

The IAA answered the Worker's Cloudflare addresses on 2026-11-02, with one earlier HTTP 403 that the relay's backoff recovered from (`docs/RELIABILITY.md`). If the IAA starts blocking it, see the fallback in `notam-relay/README.md`.

### Vercel build-skip rule
The project's Ignored Build Step is `if [ -n "$VERCEL_GIT_PREVIOUS_SHA" ] && git cat-file -e "$VERCEL_GIT_PREVIOUS_SHA" 2>/dev/null; then git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- .; else exit 1; fi`, run in the Root Directory. It compares the pushed commit with the last deployed commit (`VERCEL_GIT_PREVIOUS_SHA`), so a push of several commits builds when any of them touched `web/interviews`, and pushes that leave it unchanged (iOS-only) are skipped. When the previous commit isn't in Vercel's shallow clone, it builds. `vercel deploy` from the repo root uploads only `web/interviews`, because `.vercelignore` limits the upload; git deploys clone the repo and ignore that file. Preview deploys need the preview environment variables (`OPENAI_API_KEY`, `ADMIN_PASSWORD`, Blob).

## Set up from scratch (new account or machine)
1. **notam-relay:** `cd web/notam-relay && npx wrangler login && npx wrangler kv namespace create NOTAM_KV`; paste the id into
   `wrangler.toml`; `npx wrangler deploy`; optional `wrangler secret put RUN_SECRET`; check `/health` after 15-60 min
   (a cold backfill takes 3-4 runs). Point the app at the new URL through the `israelNotamFeedURL` default, or change `IsraelNotamService.defaultFeedURL`.
2. **charts:** `cd web/charts && npm ci && npx wrangler r2 bucket create openefb-charts`, then `r2 bucket cors set` and
   `r2 bucket dev-url enable` (commands in its README). Publish with `web/charts/publish.sh ... --remote`; `--approve` is the owner's go-ahead.
   CAAI approved in-app use of the chart and diagram artwork (chart base map (c) Mapa Ltd, used under that approval).
3. **interviews:** `cd web/interviews && npx vercel login && npx vercel link` (Root Directory `web/interviews`), create the
   private Blob store, add the env vars listed in its README, `npx vercel --prod`. The standalone `~/dev/pilot-interviews` repo is retired.

## Free-tier limits that matter (checked 2026-11-01)
- **Vercel Hobby:** non-commercial only; cron at most once a day (a `*/15` schedule fails the deploy); Blob 1 GB, 10 GB transfer/month.
  If hit: Pro ($20/month), or move the piece to Cloudflare.
- **Workers free:** 100k requests/day, 5 Cron Triggers per account, **10 ms CPU** per invocation (waiting on the network
  doesn't count), 50 subrequests per invocation, 1000 KV writes/day. The relay measured ~2-4 ms CPU locally and stays under
  50 subrequests (at most 36 detail pages per run). If CPU bites on the deployed Worker: Workers Paid, $5/month (30 s CPU).
- **Workers KV free:** 100k reads/day. Each `/notams.json` request does 2 KV reads (feed and meta), so about 50k app fetches a day would exhaust it. Open item O5 in `docs/RELIABILITY.md` (fix: `caches.default`, or serve the feed from R2).
- **R2 free:** 10 GB storage, no egress fees; r2.dev URLs are rate-limited, so use a custom domain for real traffic.
  Past 10 GB: $0.015/GB-month.

Sources: vercel.com/docs/cron-jobs/usage-and-pricing, vercel.com/docs/vercel-blob/usage-and-pricing,
developers.cloudflare.com/workers/platform/limits, developers.cloudflare.com/r2/pricing.
