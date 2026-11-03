# TestFlight materials (T30, drafted 2026-11-02)

Build 88 (1.0) passed Beta App Review on 2026-11-03 and is in the external group CHU. Releases now upload from CI (below).

**Owner decisions applied:** Q9 = upload through the Apple ID Xcode is signed in to (API key only as a fallback); Q10 = A (internal testers first, then an
external group with a public link after Beta App Review); Q12 = A (CAAI approved in-app use of the chart and diagrams,
see `NOTICE`); Q13 = B (privacy label declares Coarse Location only, `PRIVACY_NUTRITION_LABELS.md`).

## Build
`io.omer.efb`, iPad and iPhone (`TARGETED_DEVICE_FAMILY = 1,2`), iOS 26.0 or later. Display name `Kanaf`. The marketing
version comes from `version.txt` (release-please bumps it); the build number is `git rev-list --count HEAD` (or
`BUILD_NUMBER`) and must beat every earlier upload of the same version.

## Upload
Releases upload from GitHub Actions: merging the release-please pull request tags `vX.Y.Z` and the `testflight` job in
`.github/workflows/release.yml` runs `bundle exec fastlane ios beta` on a macOS runner (setup and secrets: `docs/CI.md`).
When the repository variable `TESTFLIGHT_GROUPS` names external groups (now `CHU`), the job waits for processing,
adds the build to them and submits it for Beta App Review with the release notes as What to Test.

From the owner's Mac, the same lane: `bundle install`, then `bundle exec fastlane ios beta` (add `upload:false` to
archive and sign without uploading). It reads `ASC_KEY_ID` and `ASC_ISSUER_ID` from `~/.appstoreconnect/openefb.env`,
the key from `~/.appstoreconnect/private_keys/AuthKey_<id>.p8`, and signs with the Apple Distribution identity in the
login keychain and the `io.omer.efb AppStore` profile. It never prints secrets.

## Beta App Description
Kanaf is a free, open-source VFR electronic flight bag for iPad and iPhone: a moving map, airport information
(weather, frequencies, runways, charts), flight planning, flight recording with on-device transcription, replay, a
logbook, and an on-device debrief. Two regions: Israel, the default on a new install (CVFR and sport-aviation routes,
official CAAI chart, NOTAM closures, curated aerodromes), and the United States (Settings > Region: FAA VFR sectional,
METAR/TAF, TFRs, FAA charts). It is a supplemental reference, not approved by any aviation authority, and not for
primary navigation. Israel data is unreviewed by an Israeli CFI. The debrief needs a device with Apple Intelligence.

## What to Test (sent with the first external build; CI sends each release's notes)
1. First run: onboarding and the "supplemental reference" disclaimer. A new install starts in the Israel region.
2. Map (US): switch Settings > Region to United States, then pan and zoom, sectional layer, nearest airports, tap an
   airport (METAR/TAF, frequencies, runways, charts and diagram PDFs), layers (TFR, AIRMET/SIGMET), search.
3. Flight plan: build a route, Direct-To, instrument strip, active-route bar.
4. Record a flight (simulate a route, see below): auto-start above 15 kt, stop, open it in Flights: replay, transcript,
   debrief, logbook entry.
5. Offline Maps: download a small Street region, go offline, check it still draws.
6. Israel (Settings > Region > Israel): CVFR overlay, download the official chart and diagram packs (Settings > Region),
   NOTAM briefing, plan a CVFR or LSA route, FPL message text, airport diagrams.
7. iPhone: the same flows in portrait on an iPhone.
8. Display mode Day / Night / Auto outdoors or at low brightness.
9. Settings > About: version, build, data attributions, Send Feedback.

**Known issues** (open tickets; `efb-*` are the original beads IDs): 8 of 13 Israeli
diagrams show as sheet-only PDFs (efb-aac.17); open Israel UX findings efb-aac.19 to efb-aac.30 (chart edition age
display, slow edition check on a bad connection, some red tints, 125-row briefing without a plan, layer-row wording);
Israel data awaiting CFI review (efb-aac.13); recorded-flight damaged/recovered status can be erased by a note edit
(efb-zfm.19); VoiceOver and Increase Contrast not yet checked on a device (efb-77r.35); chart packs come from a
rate-limited dev URL.

## Feedback
- In app: Settings > About > Send Feedback (mail to `kanaf@omer.io`).
- App Store Connect "Feedback Email" (TestFlight > Test Information): `kanaf@omer.io`.

## Beta App Review notes
- No login or account. No demo credentials needed.
- A new install starts in the **Israel** region. The map stays on the selected region: a position outside it (for
  example a US simulator location) is drawn but the map does not move to it. To review the US features, open Settings >
  Region > United States and simulate Palo Alto (37.4611, -122.1150), or in Xcode/Simulator choose Features > Location >
  Freeway Drive. To review Israel without moving, simulate Herzliya LLHZ (32.1794, 34.8344). Recording auto-starts
  above 15 kt.
- Background location (`UIBackgroundModes: location`): the moving map and track recording continue when the screen locks in
  flight (`CLBackgroundActivitySession`). Background audio (`audio`): cockpit audio recording for transcription and
  debrief continues while the screen is off. Both run only while the pilot has a flight recording or active navigation.
- The AI debrief uses Apple Foundation Models on the device and needs a device with Apple Intelligence; elsewhere the
  app says it is unavailable (other recording features still work). No data goes to any AI service.
- Israel features: the default region. The official chart and aerodrome diagram packs download from Settings > Region
  (also listed under Settings > Offline Maps); a one-time hint on the map points there.
- iPad and iPhone: the same app on both; layouts follow the size class.
- Encryption: standard HTTPS, SHA-256 and Keychain only (`ITSAppUsesNonExemptEncryption = NO`).
- NOTAMs for the US need the pilot's own free FAA API key (optional; Settings).

## Tester plan
1. **Internal group** first (App Store Connect users only, no Beta App Review): the owner and team. Add the uploaded build,
   fill in Test Information (the sections above).
2. **External group** with a public link after Beta App Review. Cross-link: the pilot-interview recruits
   (`https://openefb-interviews.vercel.app`, `web/interviews`) get the public TestFlight link in its TestFlight ask; add
   the link to that site once it exists. Who is invited (Q10) is the owner's call.
3. Each release goes to the external groups in `TESTFLIGHT_GROUPS` and is submitted for Beta App Review automatically
   (owner's go-ahead, 2026-11-03). Clear the variable to stop at internal testing.
