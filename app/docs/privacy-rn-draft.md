> **DRAFT, not published.** The privacy policy for the rewritten (React Native) app. `PRIVACY.md` describes the Swift app that is
> live in the App Store today and stays as it is until cutover.
>
> **At cutover** (a release step the owner approves) this text replaces `PRIVACY.md`. Diff it against the `PRIVACY.md` of that day
> first, so nothing added there since 2026-11-11 is lost; then copy everything from the `# Kanaf privacy policy` heading down, set
> the "Last updated" date, point `app/tests/telemetry/privacyPolicy.test.ts` at `PRIVACY.md` (its first comment says how), and
> delete this file.
>
> **The owner must confirm two claims then:**
>
> 1. The host name `openefb-telemetry.omerc.workers.dev` (the host table, and "the three hosts the developer runs"): it must be the
>    Worker that is deployed.
> 2. "Cloudflare keeps them for three months": the retention must match the deployed Worker config. `web/telemetry/wrangler.toml`
>    has no retention setting; the three months is Analytics Engine's own limit (Cloudflare's limits page, read 2026-11-11:
>    https://developers.cloudflare.com/analytics/analytics-engine/limits/), so check that page again at cutover.
>
> Also open: the sections A5 did not touch still describe the Swift app (iPad and iPhone, SwiftData, iOS Keychain, iOS permission
> names), and the cutover ticket revises them.

---

# Kanaf privacy policy

Last updated: 2026-11-11. Contact: kanaf@omer.io

Kanaf is a free, open-source flight-planning app for iPad and iPhone. It has no account, no ads and no cross-app tracking. It
sends anonymous usage counts (below), which you can turn off. The developer does not receive your
location, audio, transcripts, flights or logbook.

## What stays on your device

- **Location.** Used for the moving map, nearest airports and flight track recording. Stored in the app's local
  database. Never put in a network request.
- **Audio and transcripts.** Cockpit audio is recorded only during a flight recording. Transcription runs on the
  device (Apple SpeechAnalyzer on iOS; on Android the on-device speech recognizer, which needs Android 13 or later, so
  older Android versions have no transcription). Nothing is sent to Apple, Google or anyone else.
- **Debrief.** The post-flight debrief uses Apple Foundation Models on the device. No request goes to any AI service.
- **Flights, logbook, aircraft and pilot profiles.** Stored on the device (SwiftData and SQLite). iCloud sync is not
  enabled.
- **Your FAA NOTAM API key,** if you add one, is stored in the iOS Keychain.

## What the app requests over the network

| Host                                                                              | Why                                                    | What it sees                                                                   |
| --------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| aviationweather.gov (NOAA)                                                        | METAR, TAF, PIREPs, AIRMET/SIGMET, winds aloft         | station IDs, or a box around the airport you selected; your IP address         |
| tfr.faa.gov                                                                       | Temporary flight restrictions                          | your IP address                                                                |
| external-api.faa.gov, aeronav.faa.gov                                             | NOTAMs (only if you add your own key), terminal charts | the airport identifier, your own FAA key, your IP address                      |
| tiles.openfreemap.org, tiles.arcgis.com                                           | Map tiles (Street, FAA sectional)                      | the map area on screen, your IP address                                        |
| openefb-notam-relay.omerc.workers.dev (Cloudflare, run by the developer)          | Israel NOTAM feed                                      | your IP address; the app asks for the whole-country feed and sends no position |
| pub-cdfb51548498487fa9fdb9794192c8ef.r2.dev (Cloudflare R2, run by the developer) | Israel chart and diagram packs                         | the file requested and your IP address                                         |
| openefb-telemetry.omerc.workers.dev (Cloudflare, run by the developer)            | Anonymous usage counts (below)                         | the counts, your IP address                                                    |

Every host above sees your IP address, as any website does. Map tile hosts also see which map area you are looking at.
Cloudflare operates the three hosts the developer runs; the relay and counter code read no request header and store no
data about you beyond the counts described below, but Cloudflare's own logs are outside the developer's control and are
covered by Cloudflare's privacy policy.
The app never sends your GPS coordinates to any host.

## Anonymous usage counts

Kanaf counts how often its features are used, so the developer can see which ones matter and whether an update made the
app worse. It does this with a small counter service that the developer runs on Cloudflare Workers. No third-party
analytics or crash-reporting service is used.

A count is one of these events, how many times it happened, and four labels (below):

| Event                   | Extra detail                                                      |
| ----------------------- | ----------------------------------------------------------------- |
| `App.launched`          | none                                                              |
| `Navigation.screen`     | which screen: map or log                                          |
| `Recording.started`     | none                                                              |
| `Recording.stopped`     | the length in minutes, in one of three ranges: 0-15, 15-60 or 60+ |
| `FlightPlan.activated`  | none                                                              |
| `Debrief.generated`     | none                                                              |
| `ChartPack.installed`   | the name and edition of the chart pack                            |
| `Israel.briefingOpened` | none                                                              |
| `Israel.fplShared`      | how it was shared: share or email                                 |

The four labels are the app version (for example 1.2.0), the platform (iOS or Android), the over-the-air update the app is
running (an update id, or "embedded" for the version as installed from the store) and the selected region (US or Israel).

Nothing else is sent. There is no user, device, installation or session identifier (the hashed iOS vendor identifier that
earlier versions sent is gone), and no location, airport or route, aircraft, name, audio, transcript or other flight data.
The app adds the counts up on the device and sends them in batches, so a count says that something happened, not when or
to whom. The counter service reads no request header and stores each count with the time its batch arrived; the counts
cannot be linked to you, so counts already sent cannot be looked up or deleted one by one. Cloudflare keeps them for
three months.

Kanaf does not collect crash or hang reports. The App Store and Google Play give the developer their own crash statistics
for people who share them with those stores.

Turn it off in Settings > Privacy > Share anonymous usage data. Sending stops at once, and counts still waiting on the
device are deleted.

## Permissions

- **Location (While Using, and background while a flight is being recorded or navigated).**
- **Microphone and Speech Recognition,** for cockpit audio recording and on-device transcription.

You can withdraw any permission in iOS Settings. Without them the related features stop working.

## Data you can delete

Delete a recorded flight or logbook entry in the app, or delete the app to remove everything it stored.

## Children

Kanaf is not directed at children and collects no personal information.

## Changes

If the app starts collecting or sending anything new, this page and the App Store privacy label will change first.

## Not for navigation

Kanaf is a supplemental reference and is not approved by the FAA or any other aviation authority.

Source code: https://github.com/omercnet/openefb
