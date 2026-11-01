# WEB-1: One `web/` folder for everything server-side (dashboard ticket T10)

The owner wants a single web folder for the server pieces, preferring the free Vercel plan and falling back to
Cloudflare. The free-tier limits I checked on 2026-11-01 decide which piece goes where:
- **Vercel Hobby (free):** personal, non-commercial use only. Crons run **once per day at most**: a `*/15` schedule fails
  to deploy. Blob storage includes 1 GB and 10 GB of transfer a month
  (https://vercel.com/docs/cron-jobs/usage-and-pricing, https://vercel.com/docs/vercel-blob/usage-and-pricing).
- **Cloudflare free:**
  - Workers: 100k requests a day, 5 Cron Triggers per account, and **10 ms CPU** per invocation, though network waits
    don't count (https://developers.cloudflare.com/workers/platform/limits/).
  - R2: 10 GB storage free and **no egress fees** (https://developers.cloudflare.com/r2/pricing/).

## Placement
| Piece | Today | Goes to | Why |
|---|---|---|---|
| Pilot interviews (Next.js 16, OpenAI realtime, daily reap cron) | `~/dev/pilot-interviews` (its own git repo) | `web/interviews/` on **Vercel Hobby** | Fits Hobby: daily cron, small blob use |
| Israel NOTAM relay (15-minute scrape) | `services/il-notam/` (Vercel-style, `*/15` cron) | `web/notam-relay/` as a **Cloudflare Worker** with a Cron Trigger, output in R2 or KV | Hobby can't run a 15-minute cron |
| Chart packs (official CAAI CVFR MBTiles, about 100+ MB per edition) and Israel data packs | not hosted yet (IL-9 builds them locally) | **Cloudflare R2** bucket, public-read through an r2.dev or custom domain, with a manifest | Blob's 10 GB/month transfer allows only about 50 pack downloads; R2 egress is free |

## Build
1. **`web/README.md`:** the map above, the accounts needed, one-time setup per service, deploy commands, the free-tier
   limits that matter, and what to do when a limit is hit (e.g. Workers Paid at $5/month if the CPU limit bites).
   Keep it short.
2. **`web/interviews/`:**
   - Copy the app from `~/dev/pilot-interviews` (without node_modules, .next or .vercel). Note the source commit
     (`git -C ~/dev/pilot-interviews rev-parse HEAD`) in its README.
   - Leave `~/dev/pilot-interviews` untouched; the owner retires it after the first deploy from here.
   - It must build here with `npm ci && npm run build`. Keep its deploy steps (vercel link with root directory
     `web/interviews`).
3. **`web/notam-relay/`:**
   - Port `services/il-notam` to a Cloudflare Worker: a `scheduled()` handler every 15 minutes, and a `fetch()` that
     serves `notams.json` and `/health` from R2 or KV with cache headers.
   - Keep the parser and its Vitest tests: move them, don't fork them.
   - Fit the 10 ms CPU limit. Parse incrementally: only NOTAM ids not seen before, with parsed items cached in KV/R2.
     Measure CPU locally (`wrangler dev --test-scheduled`), and report the numbers.
   - Prove a real scrape through `wrangler dev` from this Mac.
   - Keep the README's fallback (run the scrape anywhere and upload), since IAA may block cloud IPs.
   - Then delete `services/il-notam/` so there's one copy. Update its references, including
     docs/handoff/IL-6.md (append a note rather than rewriting history), the Swift client's default URL setting, and
     beads `efb-aac.14`'s description.
4. **`web/charts/`:**
   - R2 bucket config (`wrangler.toml` or documented `wrangler r2 bucket create`);
   - CORS for the app;
   - the public URL layout, `/<product>/<edition>/…` plus a top-level `/<product>/manifest.json`;
   - a `publish.ts` or shell script that uploads a pack and manifest with the S3 API or wrangler, used by IL-9's
     `tools/caai-chart/publish.sh`.
   The IL-9 agent (1cf1d898-ddad-46f4-bfac-80c3f608643b) is writing that pipeline now. Message it with the final
   publish interface so its publish step targets R2, not Vercel Blob.
5. **Shared:** one root `.gitignore` for `web/**/node_modules`, `.wrangler`, `.vercel`, `.next` and `out`. Use
   per-package lockfiles; no workspace tooling unless it's needed.

Don't deploy or create any account resources: there's no Vercel or Cloudflare login here. Everything must run locally,
and the README must give the owner's exact deploy steps.

Files you own: web/**, services/il-notam (moving it), the IsraelNotam client's default-URL setting only, and the root
.gitignore.
Other agents:
- IL-9: tools/caai-chart and the Israel chart app code;
- IL-3: the map overlay;
- IL-4: the aerodromes.
Don't edit their files.

Verification:
- `npm ci && npm run build` for web/interviews;
- `npm test` plus a `wrangler dev` scrape for web/notam-relay;
- the publish script dry-run against a local S3-compatible target (e.g. miniflare's R2 or `wrangler r2` in local mode);
- the iOS unit suite, if you touch Swift.
Follow docs/handoff/COMMON.md. Close nothing; report the CPU measurements and the owner's deploy checklist. Never end
your turn on an intention.
