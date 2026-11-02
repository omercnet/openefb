# Reliability and security of Kanaf's network dependencies (CQ-7, ticket T27)

Audit date 2026-11-02. Method: the `release-it` skill (integration points, stability patterns, Quick Diagnostic) plus a
security review of the three web services. Web findings were fixed in this pass; app findings were read-only and are filed
as beads under `efb-zfm`.

## Scores

Quick Diagnostic (1 point per "yes"; see `.claude/skills/release-it/SKILL.md`):

| Check | Web services | iPad app |
|---|---|---|
| Every outbound call has a timeout | yes (relay 30 s, OpenAI 10-60 s) | yes (chart packs: 30 s request / 20 min resource, `ChartPackService.makeSession`) |
| Circuit breakers | partial: relay backoff after IAA errors | partial: retry with backoff on pack downloads, 2x/4x backoff in `DataRefreshScheduler`; no breaker |
| Bulkheads | yes (separate Workers/routes, per-dependency calls) | partial (one actor per service, one session each) |
| Zero-downtime deploy | yes (Workers versions, Vercel) | n/a (App Store) |
| Deep health check | relay yes (`/health`); interviews no | n/a |
| Correlated telemetry | no (console logs only) | no |
| Load tested past peak | no | no |
| Failure injection | unit-test simulation only | unit-test simulation only (stub sessions fail on demand) |
| **Diagnostic** | **4 / 8** | **2.5 / 7** (was 1.5; partial counts 0.5: timeouts 1 + breakers 0.5 + bulkheads 0.5 + failure injection 0.5) |

**Overall 6.5 / 15 (was 5.5 / 15; the earlier "4 / 10" summary used a different scale).** The relay is sound. The app now has a
timeout on every outbound call, retry with backoff for pack downloads, a refresh timer with backoff, honest age badges for
every dated product (TFR and AIRMET on the map itself), stale copies on disk for NOTAMs and charts, and visible failure
states. It still has no circuit breakers, telemetry or fault injection beyond unit-test stubs.

## Web services

### notam-relay (Cloudflare Worker, https://openefb-notam-relay.omerc.workers.dev)

| Concern | Before | Now |
|---|---|---|
| Scrape timeout | 30 s per fetch (fetch.ts) | same; plus 4 MiB response cap (`MAX_RESPONSE_BYTES`) |
| Retry / backoff on IAA errors | none: a 403 was retried every 15 min, forever | `consecutiveFailures` + `nextAttemptAt` in meta; wait 14 min x 2^n, capped 6 h; a 403/429 starts at 2^2 (job.ts `backoffMs`). Live evidence: `/health` showed `lastError` HTTP 403 at 00:45 UTC on 2026-11-02, recovered at 01:00 |
| KV write budget (1000/day free) | undocumented | per run: meta 1 + feed 1 + detail cache 0-1 + history 0-2, so at most 5 x 96 = 480/day, typical 192. Failed runs write 1. Backoff lowers it further |
| KV read budget (100k/day free) | unnoticed | **open**: each `/notams.json` request now does 2 reads (feed + meta) and Worker responses are not edge-cached by `Cache-Control` alone. ~50k app fetches/day would exhaust it. Fix if usage grows: `caches.default`, or serve the feed from R2 |
| Stale feed signal | `/health` 503 after 45 min; feed served with no age | `/notams.json` carries `X-Feed-Age-Seconds`, `X-Feed-Last-Success`, and when older than 45 min `Warning: 110` and `max-age=60`; `/health` reports `consecutiveFailures`, `nextAttemptAt`. The app also checks the feed's own `generatedAt` (IsraelNotamService.swift:253-254) |
| `/run` auth | SHA-256 digest compare, constant time (handler.ts:19-25), fail closed without `RUN_SECRET` | unchanged (was already correct); 401/503 now `no-store` |
| Hostile or garbled HTML | `String.fromCodePoint` threw on `&#99999999;`, failing the whole page | invalid code points left as text; tests prove 10k unterminated rows and detail blocks parse in bounded time (regexes are non-nested) |
| History store growth | unbounded index rewritten whole; corrupt index would be overwritten | caps: 50,000 ids, 5 MiB per day shard; corrupt index or shard refused, never overwritten. History failure never blocks the feed |

Tests: `web/notam-relay/test/reliability.test.ts` (13 cases) on top of the existing 75; 88 pass.
Deployed (version 470ded1a); live `/health`, `/notams.json` headers and `/run` 401s checked.

### charts (R2 bucket, `web/charts/publish.mjs`)

| Concern | State |
|---|---|
| Can never unpublish | holds: `published = approve \|\| wasPublished` (lib.mjs `buildEditionManifest`), no delete call anywhere |
| `--approve` gate | holds; **new**: refused unless the pipeline manifest has `validation.passed === true`, matching the app's `isServable` rule (IsraelChartManifest.swift:83-87) |
| Checksums | SHA-256 of every pack streamed locally and written into the manifest; the app verifies each file after download and deletes on mismatch (IsraelChartService.swift:183-185). Installed files are re-checked by size only (:149-150, bead filed) |
| Immutability | **new**: re-publishing an edition with a different hash for an existing file name is refused (packs are served `immutable` for a year); `assertImmutable` in lib.mjs |
| CORS | `cors.json`: `*`, GET/HEAD only, read-only public files; acceptable. Restrict only if a web viewer is added |
| r2.dev rate limits | **owner action**: attach a custom domain before pilots depend on it (README already says so). r2.dev is for development and is rate limited by Cloudflare |
| Path safety | `assertSegment` rejects `..`, slashes, leading dots for product, edition and file names |

Tests: 6 pass (2 new). Dry-run smoke: `--approve` without validation exits 1 with a clear message.

### interviews (Next.js on Vercel)

| Concern | Finding |
|---|---|
| Admin Basic auth | fails closed when `ADMIN_PASSWORD` unset (auth.ts:6), compare is SHA-256 + `timingSafeEqual` (limits.ts:15-19); proxy matcher covers `/admin` and `/api/admin`, and each admin route re-checks. Verified locally: 401 with the variable unset. No brute-force throttle (open, below) |
| Invite code | server-side, constant-time (limits.ts `inviteOk`). It travels in the URL, so **fixed**: `Referrer-Policy: no-referrer` |
| Daily and per-IP caps | **was bypassable**: check, then OpenAI call, then reserve (session/route.ts, old lines 47-83), so N parallel requests all passed and all paid. **Fixed**: id generated first, marker written before the OpenAI call, caps re-counted, marker removed on refusal or failure (`reserve` in limits.ts). Smoke: 5 sequential requests, cap 3, accepted 3; 10 racing, accepted 2; 40 racing against a global cap of 20, accepted 0. Never exceeded; racers exactly at the limit may all back off |
| OpenAI key exposure | server-only: `OPENAI_API_KEY` is read only in src/lib/openai.ts and the session route's presence check; no `NEXT_PUBLIC_` anywhere; the browser gets only an SDP answer. **Fixed**: OpenAI calls had no timeout; now 20 s (call), 10 s (hangup), 60 s (summary) |
| Blob privacy | `access: "private"` on every put (storage.ts:37), 128-bit random ids (`randomBytes(16)`), ids validated by `ID_RE` before any path is built. `addRandomSuffix: false` is safe because the path embeds the random id. Local fallback `fsPath` rejects traversal |
| Cron auth | `CRON_SECRET` unset gives 503, wrong token 401, constant-time compare (reap/route.ts:13-15). Verified locally |
| Upload validation | audio: type allowlist, `seq` range, size cap. **Was** 3.5 MB x 1000 parts (3.5 GB) per id and accepted forever after the interview ended. **Fixed**: 500 KB x 200 parts (100 MB ceiling), `Content-Length` pre-check, and only while the interview is active or ended less than 2 min ago (409 otherwise). Verified locally: 200, 415, 400, 413, 409, 404 for a traversal id. Transcript route: 1.5 MB cap, 2000 entries, text clamped |
| Consent before audio | holds: `/api/session` returns 400 unless `consent === true` and `consentVersion` matches (session/route.ts:38-40) before the call is created; `consentAt` is stored with the record; audio routes need that record. The flag is client-asserted, as it must be |
| Retention vs consent text | the consent copy promises deletion on request, not a retention period (strings.tsx:84-89), and the admin Delete button does that. Nothing deletes interviews automatically. The cron only reaps stuck calls. Consistent with the copy, but see O3 |
| Security headers | **added**: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy` (microphone for self only) in next.config.ts |

Lint (`tsc --noEmit`) and `next build` pass. There is no test suite in this package; behavior was smoke-tested against
`next start` with file storage (production Blob credentials were blanked for the run) and a throwaway script for the caps.

## Security findings

No CVSS scores; severity is my judgment of impact on this product.

| ID | Severity | Finding | Evidence | Status |
|---|---|---|---|---|
| S1 | Medium | Interview caps bypassable by parallel requests; each one starts a paid realtime call | session/route.ts (old 47-83), limits.ts (old 29-45) | Fixed |
| S2 | Medium | Audio upload open to anyone holding an id, up to 3.5 GB per interview, after the interview ended | interviews/[id]/audio/route.ts (old 6-7, 17-20) | Fixed |
| S3 | Low | No timeout on OpenAI calls; a slow upstream holds serverless functions | lib/openai.ts (old 18, 31, 41) | Fixed |
| S4 | Low | Invite code in URL could leak via Referer; no security headers | next.config.ts (old 3-6) | Fixed |
| S5 | Low | Relay: one malformed numeric entity aborted the scrape of the whole page | parse-html.ts:9-11 (old) | Fixed |
| S6 | Low | Relay: corrupt history index would be overwritten; index and shard unbounded | history.ts (old 28-45) | Fixed |
| S7 | Low | Relay: IAA block retried every 15 min with no backoff | job.ts (old 41-44, 77-82) | Fixed |
| O1 | Medium | Admin Basic auth has no attempt throttle and the IP-hash salt falls back to the literal `"dev"` when `ADMIN_PASSWORD` is unset (limits.ts:11). A short admin password is brute-forceable over HTTPS | auth.ts:4-14, limits.ts:10-13 | Open. Use a long random `ADMIN_PASSWORD` (24+ chars); consider a dedicated `IP_HASH_SALT` |
| O2 | Low | No Content-Security-Policy | next.config.ts | Open: needs a nonce setup for Next inline scripts |
| O3 | Low | No automatic retention: transcripts and audio of pilots are kept until someone asks for deletion | reap/route.ts, strings.tsx:84-89 | Open: state a retention period in the consent text and add a purge to the cron, or accept and document |
| O4 | Low | `/api/interviews/[id]` accepts transcript/outcome writes to anyone with the id (capability URL) while the interview is active | interviews/[id]/route.ts:44-61 | Accepted by design (128-bit id); ended interviews can only grow |
| O5 | Info | Relay KV reads not edge-cached (see capacity note above) | handler.ts | Open |
| O6 | Info | SSRF: none found. No user-controlled URL is fetched: relay URLs are constants with `encodeURIComponent(rowId)`; interviews call only `api.openai.com` | fetch.ts:1-2, 19; openai.ts:1 | Clear |
| O7 | Info | The interview summary step feeds pilot speech to a model (summary.ts); prompt injection could skew the notes. Not reviewed in depth | lib/summary.ts | Open |

## App integration points (read-only audit)

Timeouts are request/resource seconds. "Badge" means a visible data-age indicator. Full evidence with line numbers is in
the beads; the inventory:

| Integration | Timeout | Retry | Pilot sees on failure | Badge | Cache fallback | Blocks UI? |
|---|---|---|---|---|---|---|
| METAR/TAF (WeatherService.swift:34-36) | 15 / 30 | none; the map refreshes on a timer | Error + Retry also when a cached METAR is shown; TAF failure marked; offline batch serves cached stations | METAR yes; TAF yes (valid period or fetch age) | memory 15 min; stale METAR and stations served with their age | no |
| PIREP (PirepService.swift:283-285) | 15 / 30 | none | "PIREPs not loaded" + Retry | yes | none | no |
| Winds aloft (WindsAloftService.swift:365-368) | 15 / 30 | none | "not loaded" + Retry | yes, plus for-use window | memory 30 min, not served stale | no |
| AIRMET/SIGMET (AirSigmetService.swift:273-276) | 15 / 30 | scheduler: 10 min, backoff 2x/4x; both feeds must succeed | "Not loaded" + Retry only if never fetched | map badge when OLD, hidden when EXPIRED | memory 10 min; stale served, drawn faded | no |
| FAA TFR (TFRService.swift:401-402) | 15 / 60 | scheduler: 10 min, backoff 2x/4x | same as AIRMET | map badge when OLD, hidden when EXPIRED (red) | memory 10 min; stale served, drawn faded and dashed | no |
| FAA NOTAM API (NotamService.swift) | 15 / 60 per page, at most 5 pages, 30 s budget | none | error + Retry; "Refresh failed" note over a saved copy; "List incomplete" when cut off | yes, last successful answer | per airport, last good copy served on error | no |
| d-TPP index and PDFs (TerminalProcedureService.swift:160-161) | 30 / 300 | none; computed-cycle fallback | per-view error + Retry; diagram overlay failures shown and retried after 5 min | cycle badge; chart list expiry; PDF view expiry banner | disk; cached PDFs must pass the %PDF check | no |
| Israel NOTAM relay (IsraelNotamService.swift) | 15 / 60 | none client side; 5 min re-poll | Retry or "Showing the copy downloaded earlier"; "Too old: closures hidden" | yes, on relay `generatedAt` | memory and disk (Application Support) | no |
| Chart/diagram pack downloads (IsraelChartService.swift) | 30 / 20 min | 4 attempts, 2 s doubling backoff, Range resume | error text with Retry | edition badge | installed pack kept on disk; SHA-256 re-checked once per launch | no |
| Map tiles (base-style.json, MapLibre) | MapLibre default | internal | offline capsule only | sectional cycle | ambient cache + offline packs (sectional, OpenFreeMap only) | no |
| Apple Foundation Models (DebriefEngine.swift:84-102) | on-device | none | availability message, "Try Again" | `generatedAt` stored | persisted to GRDB | awaited, not blocking |

Stability patterns present: per-request timeouts (most services), in-flight de-duplication (TFR, AIRMET, d-TPP),
in-memory and disk caches, staleness classification (`DataFreshness`), generatedAt gating for the relay feed, SHA-256
verification of downloaded packs, `published` and `validation` gating of editions, all network off the main actor.
Missing: retry with backoff and jitter, circuit breakers, refresh timers, persistent stale copies for NOTAMs, map-level
staleness indicators, telemetry.

## Prioritized fixes

Done in REL-FIX (T31): fixes 1 to 4 below. Fixes 5 and 6 are owner or web actions and remain open.

1. (app, P1) Chart pack session: bounded timeouts and retry with backoff on resume. **Done.**
2. (app, P1) Visible staleness for TFR and AIRMET on the map itself, and no drawing of expired TFRs. **Done.**
3. (app, P2) Persist the last Israel NOTAM feed to disk; periodic refresh of weather, TFR and AIRMET; stale-data
   messaging when a cached METAR survives a failure; TAF badge; NOTAM API stale fallback and page cap; PDF expiry banner. **Done.**
4. (app, P3) Re-verify installed pack hashes; basemap tile failure indicator. **Done.**
5. (owner, before the pilots) Attach a custom domain to the R2 bucket; set a long `ADMIN_PASSWORD`; decide and state a
   retention period for interviews (O3).
6. (web, when usage grows) Edge-cache the relay feed or move it to R2 (O5); add a CSP to interviews (O2).

## Owner actions for env or dashboards

- Vercel (interviews): confirm `ADMIN_PASSWORD` (long and random), `CRON_SECRET`, `INVITE_CODE`, `CONTACT_EMAIL` and
  `BLOB_READ_WRITE_TOKEN` for a **private** store are set in Production. No new variables are required by these changes.
  Interviews is not deployed from this pass; the fixes ship with the next push.
- Cloudflare: relay already deployed. `RUN_SECRET` is optional (`wrangler secret put RUN_SECRET`) and only needed for a
  manual `POST /run`; note a manual run now also respects the backoff window.
- R2: attach a custom domain; keep `cors.json` applied.

## Bead status

App-side findings are beads under `efb-zfm`. REL-FIX (T31) fixed them; statuses as of 2026-11-02:

| Bead | Finding | Status | What changed |
|---|---|---|---|
| efb-zfm.10 (P1) | Chart pack session | Fixed | `ChartPackService.makeSession()`: 30 s request / 20 min resource timeout, `waitsForConnectivity`. `fetchWithRetry`: up to 4 attempts, 2 s doubling backoff with jitter, partial file kept so each retry resumes with a Range request. HTTP errors, checksum failures and Pause are not retried. Settings and the diagram section show the error with a Retry button |
| efb-zfm.11 (P1) | TFR / AIRMET age only in the layer panel | Fixed | `OverlayStaleness` (same thresholds as the badge): OLD snapshot draws faded with a dashed outline and an "OLD" badge in the map badge stack; EXPIRED snapshot is not drawn and the badge says "not shown". Re-evaluated every 30 s (`OverlayStalenessBadges`, `MapViewModel.refreshOverlayStaleness`) |
| efb-zfm.12 (P2) | Israel NOTAM copy memory-only | Fixed | Last good feed saved to Application Support (`IsraelNotamService`); an offline relaunch serves it as stale, and the existing `generatedAt` gate still decides display |
| efb-zfm.13 (P2) | No refresh in flight | Fixed | `DataRefreshScheduler`: weather 15 min, TFR and AIRMET/SIGMET 10 min (the service cache lives), doubled in Low Power Mode, none offline, only for layers that are on, 2x/4x backoff after a failed attempt. Driven once a minute from the map |
| efb-zfm.14 (P2) | Silent weather failure, no TAF badge | Fixed | The sheet shows "Weather refresh failed. Showing the last report." with Retry beside a cached METAR; the TAF has a badge and a "TAF refresh failed" line and keeps its last text |
| efb-zfm.15 (P2) | FAA NOTAM API | Fixed | Last good copy served on failure (`refreshFailed`, with its original age), page cap 5, 30 s time budget, incomplete lists are marked. The badge shows the age of the last successful FAA answer |
| efb-zfm.16 (P2) | PDF expiry, diagram failures | Fixed | `ChartPDFView` banner from the chart's own cycle (`TerminalProcedureService.cycle(code:near:)`); cached PDFs must pass the %PDF check or are re-downloaded; diagram load errors show "Airport diagram not loaded" and retry after 5 min |
| efb-zfm.17 (P3) | Pack integrity size-only | Fixed | `verifyInstalled()` re-hashes the pack once per launch off the main thread; a mismatch removes the pack and says so |
| efb-zfm.18 (P3) | Tile failure indicator | Fixed | `TileFailureTracker`: 6 consecutive tile errors with no network tile between show "Map tiles not loading" |
| efb-8lm (P2) | Proximity check fails silently | Fixed | `ProximityAlertService.checkUnavailable` and an amber "Airspace check unavailable" banner. No characterization test had pinned the old behaviour; a new test covers it |
| efb-dv5 (P2) | Offline batch drops expired stations | Fixed | Expired stations are returned from cache with their original time; two characterization tests flipped |
| efb-bgb (P2) | Error and Retry hidden with a stale METAR | Fixed | see efb-zfm.14 |
| efb-8d4 (P3) | TAF never EXPIRED | Fixed | `TAFValidity` reads the valid period from the TAF text; the age backstop is 30 h; one characterization test flipped |

Still open: stale advisories use the fetch time of the whole snapshot, not each advisory's issue time; the relay KV read budget (O5); map dots swallow a failed refresh (the age badge still ages).
