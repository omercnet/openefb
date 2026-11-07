# Kanaf privacy policy

Last updated: 2026-11-07. Contact: kanaf@omer.io

Kanaf is a free, open-source flight-planning app for iPad and iPhone. It has no account, no ads and no tracking. It
sends anonymous usage and crash summaries (below), which you can turn off. The developer does not receive your
location, audio, transcripts, flights or logbook.

## What stays on your device

- **Location.** Used for the moving map, nearest airports and flight track recording. Stored in the app's local
  database. Never put in a network request.
- **Audio and transcripts.** Cockpit audio is recorded only during a flight recording. Transcription runs on the
  device (Apple SpeechAnalyzer, or SFSpeechRecognizer set to on-device recognition). Nothing is sent to Apple or anyone
  else.
- **Debrief.** The post-flight debrief uses Apple Foundation Models on the device. No request goes to any AI service.
- **Flights, logbook, aircraft and pilot profiles.** Stored on the device (SwiftData and SQLite). iCloud sync is not
  enabled.
- **Your FAA NOTAM API key,** if you add one, is stored in the iOS Keychain.

## What the app requests over the network

| Host | Why | What it sees |
|---|---|---|
| aviationweather.gov (NOAA) | METAR, TAF, PIREPs, AIRMET/SIGMET, winds aloft | station IDs, or a box around the airport you selected; your IP address |
| tfr.faa.gov | Temporary flight restrictions | your IP address |
| external-api.faa.gov, aeronav.faa.gov | NOTAMs (only if you add your own key), terminal charts | the airport identifier, your own FAA key, your IP address |
| tiles.openfreemap.org, tiles.arcgis.com | Map tiles (Street, FAA sectional) | the map area on screen, your IP address |
| openefb-notam-relay.omerc.workers.dev (Cloudflare, run by the developer) | Israel NOTAM feed | your IP address; the app asks for the whole-country feed and sends no position |
| pub-cdfb51548498487fa9fdb9794192c8ef.r2.dev (Cloudflare R2, run by the developer) | Israel chart and diagram packs | the file requested and your IP address |
| nom.telemetrydeck.com (TelemetryDeck) | Anonymous usage and crash summaries (below) | the summaries, your IP address |

Every host above sees your IP address, as any website does. Map tile hosts also see which map area you are looking at.
Cloudflare operates the two hosts the developer runs; the relay code reads no request header and stores no data about
you, but Cloudflare's own logs are outside the developer's control and are covered by Cloudflare's privacy policy.
The app never sends your GPS coordinates to any host.

## Anonymous usage and crash summaries

Kanaf uses [TelemetryDeck](https://telemetrydeck.com/privacy/) to count how features are used and to learn about
crashes and hangs. It sends short event names (for example "a recording started", "the Flights tab was opened"), the
app version, iOS version, device model, the selected region (US or Israel) and the iOS vendor identifier, hashed on the
device so it cannot be read back. Crash and hang summaries come from Apple MetricKit: the exception type, signal,
termination reason and the top frames of the stack as binary names and offsets. No location, airport or route,
aircraft, name, audio, transcript or other flight data is ever included.
The data is not linked to you and is not used for tracking.

Turn it off in Settings > Privacy > Share anonymous usage data. Sending stops at once.

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
