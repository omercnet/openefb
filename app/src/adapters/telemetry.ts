// Wires the usage counters (domain/telemetry/telemetry.ts) to the platform: the choice and backlog in expo-sqlite's key-value store,
// counts posted to the Worker in web/telemetry, the dimensions from expo-constants, expo-updates and the platform. Nothing is
// sent until the app is built with EXPO_PUBLIC_TELEMETRY_URL set (the owner does that after deploying the Worker).
//
//   const telemetry = createTelemetry({ region: () => settings.region });
//   const stop = startTelemetry(telemetry);   // once, when the app starts
//   telemetry.signal('Recording.started');    // wherever it happens
//   telemetry.setEnabled(false);              // the Settings toggle "Share anonymous usage data"
import Constants from 'expo-constants';
import Storage from 'expo-sqlite/kv-store';
import * as Updates from 'expo-updates';
import { AppState, Platform } from 'react-native';

import type { Region } from '../domain/core/region';
import { appVersionDimension, updateDimension } from '../domain/telemetry/dimensions';
import { Telemetry } from '../domain/telemetry/telemetry';
import { createTelemetryStorage, type KeyValueStore } from './telemetryStorage';
import { createHttpTransport, telemetryEndpoint } from './telemetryTransport';

export interface TelemetryOptions {
  /** The region counts are filed under, read when a signal happens. */
  region: () => Region;
  /** The Worker's origin. Defaults to EXPO_PUBLIC_TELEMETRY_URL, which is inlined when the app is built. */
  endpoint?: string;
  /** A development build only sends to this machine. Defaults to __DEV__. */
  dev?: boolean;
  fetch?: typeof fetch;
  /** Defaults to expo-sqlite/kv-store. */
  storage?: KeyValueStore;
}

export function createTelemetry(options: TelemetryOptions): Telemetry {
  // Only a direct `process.env.EXPO_PUBLIC_*` is replaced when the app is bundled.
  const endpoint = telemetryEndpoint(options.endpoint ?? process.env.EXPO_PUBLIC_TELEMETRY_URL, options.dev ?? __DEV__);
  const app = appVersionDimension(Constants.expoConfig?.version);
  const update = updateDimension(Updates.isEmbeddedLaunch, Updates.updateId);
  return new Telemetry({
    storage: createTelemetryStorage(options.storage ?? Storage),
    transport: endpoint ? createHttpTransport(endpoint, { fetch: options.fetch }) : null,
    context: () => (app === null ? null : { app, platform: Platform.OS, update, region: options.region() }),
  });
}

/**
 * Counts the launch and sends what is waiting, then sends again each time the app goes to the background (it may be killed there)
 * and each time it comes back. Returns the function that stops it. Call once, when the app starts.
 */
export function startTelemetry(
  telemetry: Telemetry,
  appState: Pick<typeof AppState, 'addEventListener'> = AppState,
): () => void {
  const subscription = appState.addEventListener('change', (state) => {
    if (state === 'background' || state === 'active') void telemetry.flush();
  });
  telemetry.signal('App.launched');
  void telemetry.flush();
  return () => subscription.remove();
}
