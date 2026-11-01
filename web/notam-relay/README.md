# notam-relay: Israel NOTAM relay for OpenEFB (Cloudflare Worker)

Scrapes the Israel Airports Authority (IAA) NOTAM page every 15 minutes and serves `notams.json`. The iPad app downloads
that file; it never contacts the IAA site. Background: `docs/research/israel-cvfr.md` section 6.

```
Cron Trigger (*/15) -> scheduled() -> IAA list page -> one detail page per NEW or changed NOTAM (max 40 per run)
                                   -> parse (Q-line, A-G, coordinates, route-closure chains)
                                   -> KV: notams.json, detail-cache.json, meta.json
app -> GET /notams.json   (Cache-Control: public, max-age=300; CORS *)
ops -> GET /health        (200 while the last good scrape is <= 45 min old, else 503)
you -> POST /run          (Bearer RUN_SECRET; manual scrape, e.g. the first run after deploy)
```

## Why it fits the free plan

- **CPU (10 ms per invocation):** a steady-state run fetches the 1.4 MB list page and parses it, but reuses parsed
  items from KV for every NOTAM it has seen. Measured in Node (same V8, warm), CPU per run: **~2.3 ms** with nothing new,
  **~3.5 ms** when 40 detail pages are parsed, 0.1 ms to decode the list page. Network waits don't count as CPU. These are
  Node numbers: workerd doesn't expose CPU time locally, so check `wrangler tail` / the dashboard's CPU time after deploy.
- **Subrequests (50 per invocation):** list (1) plus at most 40 detail pages. A cold start therefore backfills over 3-4
  runs (about an hour); NOTAMs not yet fetched are published with `parsed: false` and raw list text meanwhile.
- **KV writes (1000 per day):** a run writes `notams.json` and `meta.json` (and the cache only when it changed): 192-288 a day.
- Wall time of a cold 40-detail run: ~22 s (400 ms politeness delay between requests). Waiting isn't CPU.

## What the scraper does

- List: `https://brin.iaa.gov.il/aeroinfo/AeroInfo.aspx?msgType=Notam` (one request, windows-1255).
- Detail: `https://brin.iaa.gov.il/MobileAeroinfo/maiDetails.aspx?rowID=<n>&scrpos=0&mode=notam`, one per new NOTAM.
- Polite: at most one run per 15 min (`MIN_INTERVAL_MS` = 14 min), sequential requests 400 ms apart, honest `User-Agent`
  naming OpenEFB with a URL.
- A failed scrape never replaces the last good `notams.json`; the error goes to `meta.json` and `/health`.
- Nothing is dropped: a NOTAM that doesn't parse, or whose detail wasn't fetched yet, is published with `parsed: false`.
- Bump `PARSER_VERSION` in `src/build.ts` when parser output changes; cached items are then re-parsed once from stored text.

## notams.json

`{ generatedAt, source, items[], closures[] }`. Types: `src/types.ts` (the app decodes the same shape in
`efb-212/Services/IsraelNotamService.swift`). `items[]` carry id, type (NOTAMN/R/C), Q-line fields, validity,
D)/E)/F)/G), geometry, `closures[]`, `cancelledBy`/`replacedBy`, `parsed`, `raw`. `closures[]` are chains of point codes
(`CVFR RTE CLSD GALIM-DAROM-HOTRM`) of items not cancelled or replaced. Expired NOTAMs stay in the IAA list; consumers
filter on validity.

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

## Deploy (owner; no Cloudflare login exists on the build machine)

1. `cd web/notam-relay && npx wrangler login`
2. `npx wrangler kv namespace create NOTAM_KV`, paste the printed `id` into `wrangler.toml`.
3. `npx wrangler deploy` (registers the `*/15` Cron Trigger; the free plan allows 5 per account).
4. Optional manual trigger: `openssl rand -hex 32 | npx wrangler secret put RUN_SECRET`, then
   `curl -X POST -H "Authorization: Bearer $RUN_SECRET" https://openefb-notam-relay.<subdomain>.workers.dev/run`.
5. Check `https://openefb-notam-relay.<subdomain>.workers.dev/health` after a run, then `/notams.json`.
6. Put `https://openefb-notam-relay.<subdomain>.workers.dev/notams.json` in the app (UserDefaults key
   `israelNotamFeedURL`; the app has no built-in default URL).

Not verified: the deployed Worker (Cron Trigger, KV, real CPU time) and whether the IAA answers Cloudflare's addresses.
`wrangler dev` runs the same code in workerd from this Mac, where the scrape succeeded.

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
