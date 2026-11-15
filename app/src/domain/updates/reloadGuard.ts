// OTA guardrails (plan 6.3): an update applies on a cold start only, and a running JS bundle is never swapped while a
// flight is being recorded. expo-updates is configured `checkAutomatically: ON_LOAD` (app.config.ts): it downloads at launch
// and the new bundle runs from the next cold start. The only code that may reload the running bundle is the OTA smoke
// screen, and it asks this first.
import type { RecordingStatus } from '../recording/recordingCoordinator';

/** A recording in any state but idle (countdown, recording, paused, stopping) blocks a reload. */
export const isRecordingActive = (status: RecordingStatus | null | undefined): boolean =>
  status != null && status.kind !== 'idle';

export const otaReloadAllowed = (status: RecordingStatus | null | undefined): boolean => !isRecordingActive(status);
