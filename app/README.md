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
src/ui/        tokens, primitives, screens, map surface, state (Zustand store)
src/app/       expo-router routes: thin files that render a screen from src/ui/screens
tests/         Jest helpers and tests that span layers (Db contract on Node sqlite, which has R-tree); unit tests sit
               next to their code as *.test.ts
```

`ios/` and `android/` are generated (CNG) and gitignored; native customisation goes in config plugins.

## Router decision

expo-router (the plan's default), with a `Slot` root layout: one screen at a time, the previous route unmounts, so only one
MapLibre view is alive (a `Stack` keeps earlier screens mounted). Deep links map to routes (`kanaf-dev://airport`,
`kanaf-dev://map?animate=1`). Launches without a URL pick a screen in `src/app/index.tsx`: iOS `-KanafScreen <screen>`,
web `?screen=`, and the Android OTA-reload marker. Stack screens (logbook, settings, replay) get a nested `Stack` layout
when they are built.

## Formatting

Prettier (`.prettierrc.json`: single quotes, 120 columns, trailing commas). `.prettierignore` lists the legacy spike files that
were not reformatted; remove a line when you rewrite that file.
