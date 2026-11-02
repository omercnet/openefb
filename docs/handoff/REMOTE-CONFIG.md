# REMOTE-CONFIG: Change app behaviour without an App Store release (remote config)

The owner wants small fixes to reach pilots without a full App Store review. The app's Swift code can't be updated
remotely: iOS only runs code Apple has signed, and App Store Review Guideline 2.5.2 bans apps that "download, install, or
execute code which introduces or changes features or functionality of the app" (checked 2026-11-02,
https://developer.apple.com/app-store/review/guidelines/). Data and server-side logic can change without a release, and
the app already relies on that:
- NOTAM parsing runs in `web/notam-relay`; a parser fix is a `wrangler deploy`.
- Chart and diagram packs come from R2 (`Services/IsraelChartService.swift`). The app installs an edition only if it is
  published and passed validation (`isServable`), and checks each file's SHA-256.

This ticket adds one more piece of data: a small config file served by the relay. It can switch listed features off,
adjust a fixed set of values, show notices, and tell pilots to update. It never adds behaviour the shipped build doesn't
already have.

**Trust: HTTPS from the relay only (owner's decision, 2026-11-02).** The file isn't signed. Anyone who controls the
Worker or the Cloudflare account can change what the file says; the limits below cap what any file can do.

## Non-goals
- No downloaded or interpreted code (no JavaScriptCore, no expression language, no server-driven UI).
- No remote switch can disable a safety function: proximity and airspace alerts, NOTAM closure blocking on filing, the
  disclaimers, data-age and expiry badges. The app keeps the list of features that can be switched off; anything not
  on that list is ignored.
- No analytics, no per-user targeting.

## Format (`config.json`, schema 1)
```json
{
  "schemaVersion": 1,
  "serial": 7,
  "issuedAt": "2026-11-02T10:00:00Z",
  "expiresAt": "2027-02-01T00:00:00Z",
  "minSupportedBuild": 1,
  "recommendedBuild": 3,
  "updateMessage": { "en": "…", "he": "…" },
  "disabledFeatures": { "israelDiagramOverlay": { "en": "…", "he": "…" } },
  "parameters": { "cvfrReportWindowSeconds": 120 },
  "notices": [ { "id": "n-2026-11-02", "severity": "info", "regions": ["israel"],
                 "until": "2026-11-09T00:00:00Z", "text": { "en": "…", "he": "…" } } ]
}
```
Only `schemaVersion`, `serial`, `issuedAt` and `expiresAt` are required. `severity` is `info` or `caution` (amber); a
remote notice is never red. `regions` takes `Region` raw values (`us`, `israel`); leave it out for every region.

## Client rules (the app)
1. **Check before using:** `schemaVersion` must be one the build understands. `serial` must not be lower than the cached
   copy's: an older file (a stale edge cache) is rejected, the same serial counts as "unchanged". A rejected file leaves
   the last good copy in effect.
2. **Expiry:** once `expiresAt` has passed, the cached copy stops applying and the built-in values are used. Then a
   forgotten kill switch can't keep a feature off forever. A file that is already expired is rejected.
3. **Only known parameters, within limits:** each parameter has a range in code (`cvfrReportWindowSeconds` 30…300 s).
   Unknown keys, wrong types and out-of-range values are ignored one by one, and the rest of the file still applies.
4. **Only listed features can be switched off:** a `disabledFeatures` key not on the allowlist is ignored. A disabled
   feature shows the message from the file in place of its UI; it doesn't just disappear.
5. **Offline first:** with no network the app uses the last good copy (Application Support), or the built-in values on
   first launch. The app never waits for the network before showing the map.
6. **When to fetch:** at launch and when the app returns to the foreground, at most once an hour. Never while recording
   is active, so it adds no network traffic in flight.
7. **Updates:** if the running build is below `minSupportedBuild`, a non-blocking amber banner on every tab shows the
   update message (dismissible for the session); below `recommendedBuild`, the message shows in Settings > About. Never
   block flying.
8. **Where to see it:** Settings > About shows the config serial and when it was checked, "Built-in" when none is in
   effect, and why the last check failed.

## Build
1. **`Core/RemoteConfig.swift`:** a `nonisolated` model that decodes leniently, the parameter table (key, range,
   built-in value) and the allowlist of features that can be switched off. Units in comments.
2. **`Services/RemoteConfigService.swift`** with `RemoteConfigServiceProtocol` (declared in that file, like the Israel services): the HTTP fetch.
   Endpoint `https://openefb-notam-relay.omerc.workers.dev/config.json`, overridable with the `remoteConfigURL` default
   (same pattern as `israelNotamFeedURL`). Errors through `EFBError.remoteConfigRejected`.
3. **`Services/RemoteConfigStore.swift`:** `@MainActor @Observable` shared store (same shape as `IsraelDiagramStore`):
   check, cache, fetch policy, and the values in effect. It's a shared store rather than an `AppState` property
   because the map overlay and the debrief loader read it and neither can reach `AppState`; `AppState` is unchanged.
   `ContentView` triggers the fetch (launch and `scenePhase == .active`) and shows the banner.
4. **First uses (one switch and one parameter, proving both paths):** the georeferenced Israel diagram overlay
   (`AirportDiagramOverlay`, `IsraelDiagramSection`) as a feature that can be switched off; the CVFR debrief
   position-report window (`CVFRDebriefBuilder.reportWindowSeconds`, 120 s) as a parameter. The ±200/±300 ft bands stay
   fixed: they are in field names and pilot-facing text, so a remote value would make the labels wrong.
5. **`efb-212Tests/Mocks/MockRemoteConfigService.swift`** and tests covering:
   - a lower serial, an unknown schema and an expired file are rejected and the cached copy stays;
   - an expired cached copy falls back to the built-in values;
   - an out-of-range, wrong-type or unknown parameter is ignored while the rest of the file applies;
   - a feature not on the allowlist can't be switched off;
   - offline first launch uses the built-in values, and a saved copy is used offline after a relaunch;
   - no fetch while recording or within the hour;
   - the relay's checked-in file decodes with nothing ignored.
6. **Relay (`web/notam-relay`):** `GET /config.json` in `src/handler.ts` serves the checked-in
   `web/notam-relay/config/app-config.json`, so every change goes through a pull request and CI before `wrangler deploy`.
   Cache header of 5 minutes. Vitest test for the route and the file's basic shape.

## Acceptance
- Full unit suite green; the new tests pass; `cd web/notam-relay && npm test` passes.
- Smoke test on the simulator against a local relay (`-remoteConfigURL http://127.0.0.1:8787/config.json` with
  `npx wrangler dev`): a file that switches off the diagram overlay changes the airport sheet text; a lower serial
  changes nothing; `minSupportedBuild` above the current build shows the banner. Screenshots of each.
- With no relay reachable and no cache, the app launches with the built-in values and Settings > About says "Built-in".

## Follow-up (not this ticket)
Chart and diagram manifests are checked per file by SHA-256, but the manifest itself is trusted because it comes from
the R2 host over HTTPS. The same is now true of the config file.

Follow docs/handoff/COMMON.md. Close nothing; report.
