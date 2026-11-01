# web/: everything server-side

| Folder | What | Runs on | Why there |
|---|---|---|---|
| `interviews/` | Pilot interviews (Next.js 16, OpenAI realtime, daily reap cron) | **Vercel Hobby** | daily cron and small Blob use fit the free plan |
| `notam-relay/` | Israel NOTAM relay: scrapes IAA every 15 min, serves `notams.json` | **Cloudflare Worker** (Cron Trigger + KV) | Hobby crons run once a day at most |
| `charts/` | Chart pack hosting (official CAAI CVFR MBTiles, Israel data packs) + publish script | **Cloudflare R2** | R2 egress is free; Blob's 10 GB/month transfer is ~50 pack downloads |

Each folder has its own `package.json` and lockfile (no workspace tooling) and its own README with details.

## Accounts
Vercel (Hobby, personal non-commercial use only) and Cloudflare (free; R2 needs a payment method on file but the free tier costs 0).
Nothing here has been deployed: there is no Vercel or Cloudflare login on the build machine.

## Owner's deploy checklist
1. **notam-relay:** `cd web/notam-relay && npx wrangler login && npx wrangler kv namespace create NOTAM_KV`; paste the id into
   `wrangler.toml`; `npx wrangler deploy`; optional `wrangler secret put RUN_SECRET`; check `/health` after 15-60 min
   (cold backfill takes 3-4 runs). Put `https://openefb-notam-relay.<subdomain>.workers.dev/notams.json` in the app
   (`israelNotamFeedURL`). **First thing to learn:** whether the IAA answers Cloudflare addresses; fallback in its README.
2. **charts:** `cd web/charts && npm ci && npx wrangler r2 bucket create openefb-charts`, then `r2 bucket cors set` and
   `r2 bucket dev-url enable` (commands in its README). Publish with `web/charts/publish.sh ... --remote`, only after the
   CAAI permission is settled.
3. **interviews:** `cd web/interviews && npx vercel login && npx vercel link` (Root Directory `web/interviews`), create the
   private Blob store, add the env vars listed in its README, `npx vercel --prod`. Then retire `~/dev/pilot-interviews`.

## Free-tier limits that matter (checked 2026-11-01)
- **Vercel Hobby:** non-commercial only; cron at most once a day (a `*/15` schedule fails the deploy); Blob 1 GB, 10 GB transfer/month.
  If hit: Pro ($20/month), or move the piece to Cloudflare.
- **Workers free:** 100k requests/day, 5 Cron Triggers per account, **10 ms CPU** per invocation (waiting on the network
  doesn't count), 50 subrequests per invocation, 1000 KV writes/day. The relay measured ~2-4 ms CPU locally and stays under
  50 subrequests (40 detail pages per run). If CPU bites after deploy: Workers Paid, $5/month (30 s CPU).
- **R2 free:** 10 GB storage, no egress fees; r2.dev URLs are rate-limited, so use a custom domain for real traffic.
  Past 10 GB: $0.015/GB-month.

Sources: vercel.com/docs/cron-jobs/usage-and-pricing, vercel.com/docs/vercel-blob/usage-and-pricing,
developers.cloudflare.com/workers/platform/limits, developers.cloudflare.com/r2/pricing.
