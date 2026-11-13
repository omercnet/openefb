// The decisions and wording of the recording controls: the static functions of ViewModels/RecordingViewModel.swift (problem
// severity, the discarded-recording notice) and the copy of Views/Map/RecordingOverlayView.swift. Pure, so they are testable
// without a view. The wording is verbatim from Swift (it still says "Settings > Kanaf > Microphone" and "iPad"; the Android
// wording is the string-table pass, U6).
import { errorDescription } from '../core/errorInfo';
import { AppFailure, type AppError } from '../errors';
import type { FlightPersistenceResult } from './flightPersistence';
import type { RecordingStatus } from './recordingCoordinator';

/** How serious a recording problem is for the pilot. */
export type ProblemSeverity = 'caution' | 'warning';

/**
 * Amber while the recording is still running (recording or paused: the GPS track continues); red once it has stopped or
 * failed to start (idle, countdown cancelled, stopping).
 */
export function problemSeverity(status: RecordingStatus): ProblemSeverity {
  return status.kind === 'recording' || status.kind === 'paused' ? 'caution' : 'warning';
}

/** A recording with no track points is discarded; the pilot is told instead of it vanishing silently. */
export const shouldShowDiscardedNotice = (result: FlightPersistenceResult): boolean => result === 'discardedEmpty';

/** What a tap on the record button does in each state (RecordButton's action). */
export type PressAction = 'start' | 'requestStop' | 'cancelCountdown' | 'none';

export function pressAction(status: RecordingStatus): PressAction {
  switch (status.kind) {
    case 'idle':
      return 'start';
    case 'recording':
      return 'requestStop';
    case 'countdown':
      return 'cancelCountdown';
    case 'paused':
    case 'stopping':
      return 'none';
  }
}

/** A cause as text; an app failure reads as its description rather than its kind. */
function causeText(cause: unknown): string {
  if (cause instanceof AppFailure) return errorDescription(cause.error);
  return cause instanceof Error ? cause.message : String(cause);
}

/** RecordingOverlayView.detail(of:): the cause without the "Recording failed:" prefix the notice title already says. */
export function problemDetail(error: AppError): string {
  switch (error.kind) {
    case 'recordingFailed':
    case 'audioSessionFailed':
      return causeText(error.cause);
    default:
      return errorDescription(error);
  }
}

export interface Notice {
  title: string;
  text: string;
}

/** The notice for `lastError`: amber while recording continues, red once it has stopped. */
export function recordingErrorNotice(error: AppError, severity: ProblemSeverity): Notice {
  const detail = problemDetail(error);
  return severity === 'caution'
    ? {
        title: 'Audio stopped',
        text: `Cockpit audio and transcript stopped. The GPS track is still recording. ${detail}`,
      }
    : { title: 'Recording failed', text: `Recording is not running. ${detail}` };
}

export const MICROPHONE_NOTICE = {
  title: 'Microphone is off',
  text: 'The GPS track still records. For cockpit audio, turn the microphone on in Settings \u203a Kanaf \u203a Microphone.',
  action: 'Open Settings',
} as const;

export const DISCARDED_NOTICE: Notice = {
  title: 'Recording not saved',
  text: 'No GPS position was recorded, so there is no flight to keep. Check that Location is on and the aircraft had a fix before starting.',
};

export const STOP_CONFIRMATION = {
  title: 'End recording?',
  message: 'Stops the GPS track, cockpit audio and transcript. The flight is saved to Flights.',
  confirm: 'End Recording',
  cancel: 'Cancel',
} as const;
