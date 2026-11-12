# Kanaf EFB (React Native)

Expo SDK 58, React Native 0.88, TypeScript. Rewrite plan: `docs/research/rn-rewrite-plan.md`. The SwiftUI app in the
repo root keeps shipping until parity.

```bash
cd app && npm ci
npm run typecheck && npm run lint && npm test     # what the app workflow's checks job and the lefthook job run
KANAF_VARIANT=dev npx expo prebuild --no-install --clean   # generates ios/ and android/ (gitignored)
```

## Identity

Production is `io.omer.efb`, "Kanaf EFB", scheme `kanaf`. `KANAF_VARIANT=dev` builds `io.omer.efb.dev`, "Kanaf EFB Dev",
scheme `kanaf-dev` (the iOS project is then `KanafEFBDev`). CI builds and the OTA smoke use the dev variant.
`app.config.ts` is the only place that decides this.

## Layout

```
src/domain/    pure TypeScript: no react, react-native, expo* or @maplibre imports (eslint no-restricted-imports)
src/data/      the Db interface and, later, schema, migrations and repositories; same import ban as domain
src/adapters/  platform wrappers (expo-sqlite, file store, ...) behind interfaces defined in domain or data
modules/       local Expo modules, autolinked (kanaf-speech: iOS 26 SpeechAnalyzer, docs/port-notes/A3.md)
src/ui/        tokens, primitives, screens, map surface, state (Zustand store)
src/app/       expo-router routes: thin files that render a screen from src/ui/screens
tests/         Jest helpers and tests that span layers (Db contract on Node sqlite, which has R-tree); unit tests sit
               next to their code as *.test.ts
```

`ios/` and `android/` are generated (CNG) and gitignored; native customisation goes in config plugins.

## UI data and fidelity screens

Screens read their data through hooks over Zustand slices made with `src/ui/state/storeContext.tsx`
(`createStoreContext(fixture)`): the default store is seeded with a fake, tests and capture routes swap it with the
slice's `Provider`, and the integration ticket (I1) feeds the real services in with `store.setState(...)`. Component
tests use `test-renderer` through `tests/support/ui.tsx` (`render`, `press`, `callHandler`).

A screen joins the fidelity gate (plan 5.4, `scripts/compare.mjs`) in five places: its route (`src/app/<screen>.tsx`,
which opens the strip with `MapScreen screen="<screen>"` or renders the screen), `LAUNCH_SCREENS` in
`src/app/index.tsx`, the screen lists in `scripts/ios-capture.sh` and `scripts/android-capture.sh`, its floors in
`scripts/fidelity-thresholds.json`, and `reference/ipad-<screen>.png`: the Swift app's screenshot (the `scenario-captures`
artifact of the Swift CI job, `tools/ci/capture-screens.sh`), 2064x2752 downscaled to 1032x1376 with sharp. The fake
behind the screen must reproduce what the reference shows. The score is the leading 400 pt of the frame; a screen that is not
a strip (the full-width Log) sets `"metric": "frame"` in its iOS floor to be gated on the whole frame (Android compares only its 400 dp strip: the
screen is 800 dp wide, so a whole-frame crop does not line up). `tests/config/fidelityGate.test.ts`
fails when one of the five places is missing for a gated screen.

## Router decision

expo-router (the plan's default), with a `Slot` root layout: one screen at a time, the previous route unmounts, so only one
MapLibre view is alive (a `Stack` keeps earlier screens mounted). Deep links map to routes (`kanaf-dev://airport`,
`kanaf-dev://map?animate=1`). Launches without a URL pick a screen in `src/app/index.tsx`: iOS `-KanafScreen <screen>`,
web `?screen=`, and the Android OTA-reload marker. Stack screens (logbook, settings, replay) get a nested `Stack` layout
when they are built.

## Formatting

Prettier (`.prettierrc.json`: single quotes, 120 columns, trailing commas). `.prettierignore` lists the legacy spike files that
were not reformatted; remove a line when you rewrite that file.
