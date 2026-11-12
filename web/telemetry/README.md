# telemetry: anonymous usage counters (Cloudflare Worker, NOT DEPLOYED)

Owner decision Q7: the React Native app counts feature use with first-party counters on a Worker run by the developer, with no
identifiers, instead of TelemetryDeck. This is that Worker. **It is not deployed, and nothing in CI or on merge deploys it.**
Deploying it, and pointing the app at it, are the owner's steps (below). Until both are done the app sends nothing.

It is a sibling of `ota/` and `notam-relay/` on purpose: `ota/` is documented as read-only and holds the update-signing path, so
a public write endpoint does not belong there.

## What the app sends

`POST /v1/counters` with a JSON body of at most 16 KB and at most 40 rows. Every row is a count of one event, with the app version,
platform, OTA update id and region it happened under:

```json
{
  "v": 1,
  "counters": [
    { "event": "Recording.started", "app": "1.2.0", "platform": "ios", "update": "embedded", "region": "us", "count": 2 },
    { "event": "Recording.stopped", "params": { "durationMinutes": "15-60" }, "app": "1.2.0", "platform": "ios",
      "update": "embedded", "region": "us", "count": 1 }
  ]
}
```

`src/schema.json` is the whole vocabulary: the events (`App.launched`, `Navigation.screen`, `Recording.started`,
`Recording.stopped`, `FlightPlan.activated`, `Debrief.generated`, `ChartPack.installed`, `Israel.briefingOpened`,
`Israel.fplShared`), their parameters (a closed list of values, or a short lower-case name for chart packs), the platforms
(`ios`, `android`), the regions (`us`, `israel`), the app version (three numbers), the update id (`embedded` or a UUID) and the
largest count. A row that does not fit exactly (an unknown event, a missing or extra field, a value outside the schema, a field of
the wrong type) is dropped, never stored. The answer is `202 {"accepted": n, "dropped": m}`; a body that is not a batch at all is
`400`, over 16 KB is `413`, and a Worker without its binding is `503`.

The app keeps a typed copy of the schema (`app/src/domain/telemetry/schema.ts`), and a test in `app/` fails when the two differ.

## What is stored, and what is not

Each accepted row becomes one Workers Analytics Engine data point in the dataset `kanaf_counters`:

| Column | Holds |
|---|---|
| `index1` | the event |
| `blob1` .. `blob5` | event, app version, platform, update id, region |
| `blob6`, `blob7` | the event's parameter values, in the order `schema.json` lists them (empty when it has none) |
| `double1` | the count |
| `timestamp` | when the batch arrived, added by Analytics Engine |

Analytics Engine stores data for three months.

The Worker reads **no request header and no Cloudflare property** (`request.cf`), only the URL path, the method and the body, so no
address, user agent, cookie, location or token can reach storage; a test makes the request object throw if the handler touches
either. It sets no cookie and echoes nothing from the request. There is no user id, device id, session id or per-device value in the
body or the schema. What it cannot hide: Cloudflare sees the sender's IP address as it does for any request (PRIVACY.md says so),
and rows of one batch share an arrival time, so a batch can be told apart from other batches, though not linked to a person or to
a later batch.

## Owner: deploying (not done)

Prerequisite: the Cloudflare account already used for the other Workers (free plan; Analytics Engine's free allowance is 100,000
data points written and 10,000 read queries per day). The app batches, so a flush is one request of up to 40 rows.

```
cd web/telemetry
npm ci
npm test && npm run typecheck
npx wrangler deploy          # creates https://openefb-telemetry.omerc.workers.dev; the first write creates the dataset
curl https://openefb-telemetry.omerc.workers.dev/health    # ok
```

Then build the app with `EXPO_PUBLIC_TELEMETRY_URL=https://openefb-telemetry.omerc.workers.dev`. A release build sends over HTTPS
only; a development build (the app run from source) sends only to a Worker on the same machine, such as `npm run dev` below
(the Android emulator reaches it at `http://10.0.2.2:8788`), so nobody's test runs reach the deployed Worker. The app sends nothing
while that variable is empty or the user has turned "Share anonymous usage data" off. The policy text for the rewritten app is the
draft `app/docs/privacy-rn-draft.md`, which replaces `PRIVACY.md` at cutover (a release step the owner approves; the draft's header
lists the two claims to confirm then). Until it does, do not ship a public build that has the variable set: the live `PRIVACY.md`
describes the Swift app and promises to change before the app sends anything new.

To stop it: delete the Worker, or build the app without the variable.

## Reading the counters

Analytics Engine samples at very high volume, so sum `_sample_interval * double1` rather than counting rows. With an API token that
has Account Analytics Read:

```
curl "https://api.cloudflare.com/client/v4/accounts/<account_id>/analytics_engine/sql" \
  --header "Authorization: Bearer <API_TOKEN>" \
  --data "SELECT blob1 AS event, blob4 AS update_id, SUM(_sample_interval * double1) AS n
          FROM kanaf_counters WHERE timestamp > NOW() - INTERVAL '7' DAY
          GROUP BY event, update_id ORDER BY n DESC"
```

Launches per update (the denominator of the crash-free comparison per update in the rewrite plan, section 6.3) are the `App.launched` rows.

## Changing the vocabulary

A new event or parameter needs all of these in one change: `src/schema.json`, the app's `schema.ts` (the contract test enforces
the match), `test/schema.test.ts` (it pins the list on purpose), and the usage-counts section of the policy text
(`app/docs/privacy-rn-draft.md` until cutover, then `PRIVACY.md`). Deploy the Worker
before shipping an app that sends the new event; until then the old Worker drops those rows.

## Not covered

The endpoint is public and unauthenticated, as an anonymous counter has to be, so anyone can post valid rows and inflate counts;
treat the numbers as indicative. The Workers rate limiting binding is not used (it is not on the free plan). A write refused
halfway through a batch returns `503`, and the app resends the whole batch, so the rows already written can be counted twice.

## Develop

```
npm ci
npm test            # vitest: schema and handler, no network
npm run typecheck
npm run dev         # wrangler dev on http://127.0.0.1:8788, local Analytics Engine
```
