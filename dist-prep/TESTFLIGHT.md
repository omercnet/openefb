# TestFlight materials (T30, drafted 2026-11-02)

Draft for the owner. Nothing here has been uploaded or entered in App Store Connect.

**Owner decisions applied:** Q9 = upload through the Apple ID Xcode is signed in to (API key only as a fallback); Q10 = A (internal testers first, then an
external group with a public link after Beta App Review); Q12 = A (CAAI approved in-app use of the chart and diagrams,
see `NOTICE`); Q13 = B (privacy label declares Coarse Location only, `PRIVACY_NUTRITION_LABELS.md`).

## Build
`io.omer.efb`, version 1.0, iPad only, iOS 26.0 or later. Display name `Kanaf`. Build numbers must increase on every
upload; `upload-testflight.sh` sets `CURRENT_PROJECT_VERSION` from `git rev-list --count HEAD` (or `BUILD_NUMBER`).

## Upload (Q9; the integrator runs it after the app record exists)
Prerequisites: Xcode on this Mac is signed in to the owner's Apple ID for team 6F8N897928 (Xcode > Settings > Accounts),
and the App Store Connect app record for bundle `io.omer.efb` exists (app 6829641724; My Apps > + > New App: iPad, name Kanaf EFB, SKU
any, bundle `io.omer.efb`). Then:
```
dist-prep/upload-testflight.sh
```
The script archives Release (generic iOS device, `-allowProvisioningUpdates`, build number from `git rev-list --count HEAD`
or `BUILD_NUMBER`) and runs `xcodebuild -exportArchive` with `dist-prep/ExportOptions.plist` (app-store-connect,
`destination` upload, team 6F8N897928, automatic signing, `uploadSymbols` true, `manageAppVersionAndBuildNumber` false),
which uploads to App Store Connect. Fallback: if `ASC_KEY_ID` and `ASC_ISSUER_ID` are set, it authenticates with the key at
`~/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8` and refuses to run if that file is missing. It never prints
secrets. Nothing has been uploaded.

## Beta App Description
Kanaf is a free, open-source VFR electronic flight bag for iPad: a moving map with the FAA VFR sectional, airport
information (METAR/TAF, frequencies, runways, charts), flight planning, flight recording with on-device transcription,
replay, a logbook, and an on-device debrief. Region coverage: United States (default) and Israel (Settings > Region:
CVFR and sport-aviation routes, NOTAM closures, curated aerodromes). It is a supplemental reference, not FAA-approved,
and not for primary navigation. Israel data is unreviewed by an Israeli CFI. The debrief needs a device with Apple
Intelligence. Satellite and Terrain base maps need a connection and are for testing only.

## What to Test (build 1.0 (1))
1. First run: onboarding and the "not FAA-approved / supplemental" disclaimer.
2. Map (US): pan and zoom, sectional layer, nearest airports, tap an airport (METAR/TAF, frequencies, runways, charts
   and diagram PDFs), layers (TFR, AIRMET/SIGMET), search.
3. Flight plan: build a route, Direct-To, instrument strip, active-route bar.
4. Record a flight (simulate a route, see below): auto-start above 15 kt, stop, open it in Flights: replay, transcript,
   debrief, logbook entry.
5. Offline Maps: download a small Street region, go offline, check it still draws.
6. Settings > Region > Israel: CVFR overlay, download the chart pack (Settings > Offline Maps), NOTAM briefing, plan a
   CVFR or LSA route, FPL message text, airport diagrams.
7. Display mode Day / Night / Auto outdoors or at low brightness.
8. Settings > About: version, build, data attributions, Send Feedback.

**Known issues** (open beads): Satellite/Terrain terms (efb-zfm.8, removed before public release); 8 of 13 Israeli
diagrams show as sheet-only PDFs (efb-aac.17); open Israel UX findings efb-aac.19 to efb-aac.30 (chart edition age
display, slow edition check on a bad connection, some red tints, 125-row briefing without a plan, layer-row wording);
Israel data awaiting CFI review (efb-aac.13); recorded-flight damaged/recovered status can be erased by a note edit
(efb-zfm.19); VoiceOver and Increase Contrast not yet checked on a device (efb-77r.35); chart packs come from a
rate-limited dev URL.

## Feedback
- In app: Settings > About > Send Feedback (mail to `feedback@quartermint.com`, the address in the app today).
- Owner to confirm or replace: **`<OWNER FEEDBACK EMAIL: fill in>`** (also the App Store Connect "Feedback Email").

## Beta App Review notes
- No login or account. No demo credentials needed.
- Location simulation: in Xcode/Simulator choose Features > Location > Freeway Drive, or on a device use a GPX-driven
  scheme. Default start is the nearest US airport (for example KPAO). Recording auto-starts above 15 kt.
- Background location (`UIBackgroundModes: location`): the moving map and track recording continue when the screen locks in
  flight (`CLBackgroundActivitySession`). Background audio (`audio`): cockpit audio recording for transcription and
  debrief continues while the screen is off. Both run only while the pilot has a flight recording or active navigation.
- The AI debrief uses Apple Foundation Models on the device and needs an Apple Intelligence iPad; elsewhere the app says it
  is unavailable (other recording features still work). No data goes to any AI service.
- Israel features: Settings > Region > Israel. The chart pack downloads from Settings > Offline Maps.
- Encryption: standard HTTPS, SHA-256 and Keychain only (`ITSAppUsesNonExemptEncryption = NO`).
- NOTAMs for the US need the pilot's own free FAA API key (optional; Settings).

## Tester plan
1. **Internal group** first (App Store Connect users only, no Beta App Review): the owner and team. Add build 1.0 (1),
   fill in Test Information (the sections above).
2. **External group** with a public link after Beta App Review. Cross-link: the pilot-interview recruits
   (`https://openefb-interviews.vercel.app`, `web/interviews`) get the public TestFlight link in its TestFlight ask; add
   the link to that site once it exists. Who is invited (Q10) is the owner's call.
3. Submit to Beta App Review for the external group only on the owner's go-ahead.
