# notam-relay: Israel NOTAM relay for Kanaf (Cloudflare Worker)

Scrapes the Israel Airports Authority (IAA) NOTAM page every 15 minutes and serves `notams.json`. The iPad app downloads
that file; it never contacts the IAA site. Background: `docs/research/israel-cvfr.md` section 6.

```
Cron Trigger (*/15) -> scheduled() -> IAA list page -> one detail page per NEW or changed NOTAM (max 36 per run)
                                   -> parse (Q-line, A-G, coordinates, route-closure chains)
                                   -> KV: notams.json, detail-cache.json, meta.json, history-*.json
app -> GET /notams.json   (Cache-Control: public, max-age=300; CORS *)
ops -> GET /health        (200 while the last good scrape is <= 45 min old, else 503)
you -> POST /run          (Bearer RUN_SECRET; manual scrape, e.g. the first run after deploy)
```

## Why it fits the free plan

- **CPU (10 ms per invocation):** a steady-state run fetches the 1.4 MB list page and parses it, but reuses parsed
  items from KV for every NOTAM it has seen. Measured in Node (same V8, warm), CPU per run: **~2.3 ms** with nothing new,
  **~3.5 ms** when 40 detail pages are parsed (a run is capped at 36 now), 0.1 ms to decode the list page. Network waits don't count as CPU. These are
  Node numbers: workerd doesn't expose CPU time locally, so check `wrangler tail` / the dashboard's CPU time after deploy.
- **Subrequests (50 per invocation, KV calls count):** list (1) plus at most 36 detail pages (`MAX_DETAIL_REQUESTS` in `src/job.ts`), leaving room for up to 9 KV calls. A cold start therefore backfills over 3-4
  runs (about an hour); NOTAMs not yet fetched are published with `parsed: false` and raw list text meanwhile.
- **KV writes (1000 per day):** a run writes `meta.json` and `notams.json` (and the detail cache only when it changed), and history adds up to two writes on runs that saw a new NOTAM: at most 5 x 96 = 480 a day, typically 192, well inside 1000. Failed runs write 1, and the backoff lowers the rate further.
- Wall time of a cold 40-detail run (measured before the 36-page cap): ~22 s (400 ms politeness delay between requests). Waiting isn't CPU.

## What the scraper does

- List: `https://brin.iaa.gov.il/aeroinfo/AeroInfo.aspx?msgType=Notam` (one request, windows-1255).
- Detail: `https://brin.iaa.gov.il/MobileAeroinfo/maiDetails.aspx?rowID=<n>&scrpos=0&mode=notam`, one per new NOTAM.
- Polite: at most one run per 15 min (`MIN_INTERVAL_MS` = 14 min), sequential requests 400 ms apart, honest `User-Agent`
  naming Kanaf with a URL.
- A failed scrape never replaces the last good `notams.json`; the error goes to `meta.json` and `/health`.
- Nothing is dropped: a NOTAM that doesn't parse, or whose detail wasn't fetched yet, is published with `parsed: false`.
- Bump `PARSER_VERSION` in `src/build.ts` when parser output changes; cached items are then re-parsed once from stored text.

## notams.json

`{ generatedAt, source, items[], closures[] }`. Types: `src/types.ts` (the app decodes the same shape in
`efb-212/Services/IsraelNotamService.swift`). `items[]` carry id, type (NOTAMN/R/C), Q-line fields, validity,
D)/E)/F)/G), geometry, `closures[]`, `cancelledBy`/`replacedBy`, `parsed`, `raw`. `closures[]` are chains of point codes
(`CVFR RTE CLSD GALIM-DAROM-HOTRM`) of items not cancelled or replaced. Expired NOTAMs stay in the IAA list; consumers
filter on validity.

Each closure is one clause of E): `routeKind` (CVFR when the clause covers CVFR, kept for builds that read only that field),
`routeKinds` (all kinds: "CVFR AND HEL RTE CLSD"), `chain`, `closedAltitudes` / `availableAltitudes` (feet; AT, BLW, ABV, BTN;
`direction: "BIDIRECTIONAL"`), `exceptions` (raw text, e.g. "PPR FLT FM IAF"), `partial` (closed only at some altitudes, or with
exceptions), `parsed` and `raw`. A clause that looks like a closure but cannot be read in full is still emitted, with
`parsed: false` (no chain, or an altitude condition left unread): consumers must show it as "possible closure, read NOTAM".
Fields are only ever added: shipped app builds decode this file.

## History corpus

Every NOTAM the relay sees is recorded once (id plus verbatim ICAO text) in KV: `history-index.json` (all ids) and
`history-YYYY-MM-DD.json` (`[{ id, raw, seenAt }]`, first seen that UTC day). Use it as a regression corpus:
`npx wrangler kv key get --binding NOTAM_KV --remote history-2026-11-01.json`. Local coverage check over any archive of
`{ notams: [{ id, description }] }`: `npm run corpus -- /tmp/notams.json [--misses] [--flagged]` (keep such archives out of the repo).

## Run it locally

```
cd web/notam-relay
npm ci
npm test                          # Vitest on saved IAA samples
npm run dev                       # wrangler dev --test-scheduled, local KV, http://127.0.0.1:8787
curl "http://127.0.0.1:8787/cdn-cgi/handler/scheduled?cron=*/15+*+*+*+*"   # real scrape (waits ~20 s on a cold cache)
curl http://127.0.0.1:8787/health; curl http://127.0.0.1:8787/notams.json
npm run scrape -- --force         # no wrangler: plain node scrape into .data/ and out/notams.json
```

Local KV lives in `.wrangler/state` (ignored). To rerun inside the 14-minute guard:
`npx wrangler kv key delete --binding NOTAM_KV --local meta.json`.

## Deploy

Deployed at `https://openefb-notam-relay.omerc.workers.dev` (checked 2026-11-02: `/health` 200, `/notams.json` served with `X-Feed-Age-Seconds`; the `NOTAM_KV` id is in `wrangler.toml`). To deploy again or on a new account:

1. `cd web/notam-relay && npx wrangler login`
2. `npx wrangler kv namespace create NOTAM_KV`, paste the printed `id` into `wrangler.toml`.
3. `npx wrangler deploy` (registers the `*/15` Cron Trigger; the free plan allows 5 per account).
4. Optional manual trigger: `openssl rand -hex 32 | npx wrangler secret put RUN_SECRET`, then
   `curl -X POST -H "Authorization: Bearer $RUN_SECRET" https://openefb-notam-relay.<subdomain>.workers.dev/run`.
5. Check `https://openefb-notam-relay.<subdomain>.workers.dev/health` after a run, then `/notams.json`.
6. A new URL needs the app to know it: set the `israelNotamFeedURL` UserDefaults key, or change `IsraelNotamService.defaultFeedURL`
   (the app's built-in default is the URL above).

Not verified: the deployed Worker's real CPU time per run (check `wrangler tail` or the dashboard).
On 2026-11-02 the IAA answered the Worker's Cloudflare addresses; one HTTP 403 earlier that day recovered through the backoff (`docs/RELIABILITY.md`).

## Risk: the IAA may block cloud IPs

The IAA site sits behind a WAF and publishes no terms for automated access. Symptoms on the deployed Worker: `/health`
503 with `lastError` like `IAA returned HTTP 403` or `IAA list page held no NOTAM rows`. Fallback: run the same code on
any always-on machine and upload the result to the same KV, so the app URL doesn't change:

```
*/15 * * * *  cd /path/to/web/notam-relay && npm run scrape && npm run publish-local >> scrape.log 2>&1
```

`npm run scrape` writes `.data/` and `out/notams.json`; `npm run publish-local` puts `notams.json` and `meta.json` into KV
(needs `wrangler login` on that machine). Remove the `[triggers]` block from `wrangler.toml` and redeploy so the Worker's own cron
doesn't overwrite the file with failures. Or skip KV: upload `out/notams.json` to any static host and point the app there.
