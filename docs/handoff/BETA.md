# BETA: Prepare the beta release and ship to TestFlight (dashboard T30)

The final ticket of this run. It starts after T25 (the full test run, commit and push), so it ships exactly the committed,
verified tree. Read dist-prep/ (README, ARCHIVE_CONFIG, APP_STORE_METADATA, PRIVACY_NUTRITION_LABELS, screenshots)
first; T13 and T15 prepared most of it.

Current facts from the project file:
- the app's bundle ID is `io.omer.efb` and its team `6F8N897928` (owner-set; keep them);
- automatic signing;
- MARKETING_VERSION 1.0, CURRENT_PROJECT_VERSION 1;
- the test targets still carry `quartermint.efb-212Tests` / `…UITests` and team SKGLKG576D. They aren't shipped, but
  align their team with the app if it blocks archiving;
- `efb-212/PrivacyInfo.xcprivacy` exists.

## 1. Release readiness (code and config; fix what's wrong)
- **Display name:** the home-screen name is still `efb-212` (AGENTS.md Known Issues). Set
  `INFOPLIST_KEY_CFBundleDisplayName = OpenEFB`.
- **Version and build:** 1.0 (build N). Build numbers must increase on every upload; document the rule in
  dist-prep/README.md.
- **Info.plist usage strings:** location, background location, microphone and speech recognition must be accurate,
  plain, and name the pilot benefit. Check the background modes (location, audio) are justified and actually used,
  because Beta App Review checks this.
- **Export compliance:** set `ITSAppUsesNonExemptEncryption = NO` if the app only uses standard HTTPS/OS crypto. Verify
  that before setting it.
- **Privacy manifest:** check `PrivacyInfo.xcprivacy` declares the required-reason APIs actually used (UserDefaults,
  file timestamps, disk space, system boot time, …): grep the code, MapLibre and GRDB. List the data collected. The app
  collects nothing for us, but it calls third parties: NOAA, the FAA, the NOTAM relay, R2 and the tile hosts. Update
  PRIVACY_NUTRITION_LABELS.md so it matches.
- **Beta behaviour:**
  - the beta banner and the in-app "Report problems" path work;
  - the Settings > About version, build, data attributions (CAAI, FAA, NOAA, OpenFreeMap, …) and disclaimers are
    present;
  - the "not FAA-approved / supplemental only" wording is on first run.
- **Israel region:** the owner's data permissions cover app use (CAAI GIS data approved; official chart and diagram
  packs approved for app consumption). Satellite and Terrain stay for TestFlight (Q1 = A); their removal is efb-zfm.8,
  before public release.
- **Release build:** a Release archive builds with 0 warnings. Smoke-test the Release build on the simulator: launch,
  US map, Israel region, chart download, record/stop.

## 2. TestFlight materials (dist-prep/TESTFLIGHT.md)
- **Beta App Description:** what OpenEFB is, what to test, the region coverage (US + Israel), the limitations.
- **What to Test notes** for this build: the main flows to exercise and known issues, taken from open beads.
- **Feedback:** the email (owner to fill in; leave a clearly marked placeholder) and the in-app path.
- **Beta App Review notes:**
  - no login needed;
  - the location simulation tip for reviewers;
  - the background location and audio justification;
  - the AI debrief needs Apple Intelligence devices;
  - Israel features need the region switch in Settings.
- **Tester plan:** internal group first (no review needed); then an external group with a public link after Beta App
  Review. The external group is where the pilot interview recruits go: cross-link the interview site's TestFlight ask.

## 3. Archive and upload
- Archive with `xcodebuild archive` (Release, generic iOS device) and `-exportArchive` with an `ExportOptions.plist`
  (method app-store-connect, team 6F8N897928, automatic signing).
- **Uploading needs the owner's credentials.** See the integrator's question on the dashboard for the method. Never
  hardcode or commit keys. If an App Store Connect API key is provided, it lives at
  `~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8`, with the key id and issuer id passed as env vars
  (`ASC_KEY_ID`, `ASC_ISSUER_ID`), and you upload with
  `xcrun altool --upload-app` / `xcodebuild -exportArchive -allowProvisioningUpdates -authenticationKeyPath …`.
  Otherwise, leave the `.xcarchive` ready and write the Organizer steps for the owner.
- The App Store Connect app record must exist (bundle `io.omer.efb`). If it doesn't, write the exact owner steps.
- After upload: the build appears in TestFlight. Add the build to the internal group, fill in the test information,
  and submit to Beta App Review for the external group only if the owner approves.

## 4. Commit
Config and docs changes go in one signed commit, made by the integrator. Don't commit yourself; report the files changed.

Follow docs/handoff/COMMON.md (claim a simulator with `export SIM_TAG=$(tools/sim-test.sh claim BETA)` and release it).
Report: the readiness checklist with pass/fix/owner-action per item, the archive path, the upload result, and the exact
steps left for the owner.

Record progress on the Paseo dashboard as you work:
- at each new stage: cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticket update T30 --stage <stage>
- between stages:    cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticker set "<what you are doing now>"
Use the stages Build, Review, Fixes and Verify. Never end your turn on an intention.
