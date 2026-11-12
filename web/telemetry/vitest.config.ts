import { defineConfig } from "vitest/config";

// test/appClient.test.ts imports the app's own source (app/src) to run its real client against this handler. The nearest tsconfig of
// those files, app/tsconfig.json, extends expo's base, which only exists where app/ has its dependencies installed; this
// package's CI job installs only web/telemetry. A tsconfigRaw given as a string makes esbuild skip the tsconfig lookup.
export default defineConfig({ esbuild: { tsconfigRaw: "{}" } });
