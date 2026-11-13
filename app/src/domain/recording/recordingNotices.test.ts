// Ports of ViewModelTests/RecordingProblemSeverityTests (2) and the "discardedEmptyShowsNoticeSavedDoesNot" case of
// MapGPSRecordingFixesTests, plus characterisation of the wording and decisions in RecordingViewModel.swift and
// Views/Map/RecordingOverlayView.swift (no Swift test covers them).
import { errorDescription } from '../core/errorInfo';
import { AppFailure, type AppError } from '../errors';
import type { FlightPersistenceResult } from './flightPersistence';
import {
  DISCARDED_NOTICE,
  MICROPHONE_NOTICE,
  pressAction,
  type PressAction,
  problemDetail,
  problemSeverity,
  recordingErrorNotice,
  shouldShowDiscardedNotice,
  STOP_CONFIRMATION,
} from './recordingNotices';
import { RecordingError, type RecordingStatus } from './recordingCoordinator';

describe('Recording problem severity', () => {
  test('runningRecordingIsCaution', () => {
    expect(problemSeverity({ kind: 'recording' })).toBe('caution');
    expect(problemSeverity({ kind: 'paused' })).toBe('caution');
  });

  test('stoppedOrNeverStartedRecordingIsWarning', () => {
    expect(problemSeverity({ kind: 'idle' })).toBe('warning');
    expect(problemSeverity({ kind: 'stopping' })).toBe('warning');
    expect(problemSeverity({ kind: 'countdown', remaining: 2 })).toBe('warning');
  });
});

describe('Discard notice', () => {
  test('discardedEmptyShowsNoticeSavedDoesNot', () => {
    expect(shouldShowDiscardedNotice('discardedEmpty')).toBe(true);
    expect(shouldShowDiscardedNotice('saved')).toBe(false);
  });

  test('only a recording with no track is "not saved"; a kept-but-damaged or failed save has its own error instead', () => {
    const others: FlightPersistenceResult[] = ['savedTrackUnreadable', 'saveFailed'];
    for (const result of others) expect(shouldShowDiscardedNotice(result)).toBe(false);
  });
});

describe('pressAction (what a tap on the record button does)', () => {
  const cases: [RecordingStatus, PressAction][] = [
    [{ kind: 'idle' }, 'start'],
    [{ kind: 'recording' }, 'requestStop'],
    [{ kind: 'countdown', remaining: 3 }, 'cancelCountdown'],
    [{ kind: 'countdown', remaining: 1 }, 'cancelCountdown'],
    [{ kind: 'paused' }, 'none'],
    [{ kind: 'stopping' }, 'none'],
  ];
  test.each(cases)('%j -> %s', (status, action) => {
    expect(pressAction(status)).toBe(action);
  });
});

describe('problemDetail (RecordingOverlayView.detail(of:))', () => {
  test('a recording failure shows its cause without the "Recording failed:" prefix the title already says', () => {
    const error: AppError = { kind: 'recordingFailed', cause: new RecordingError('trackWriteFailed') };
    expect(problemDetail(error)).toBe("The GPS track could not be saved. Some of this flight's track is missing.");
  });

  test('an audio failure shows its cause', () => {
    expect(problemDetail({ kind: 'audioSessionFailed', cause: new Error('No microphone found.') })).toBe(
      'No microphone found.',
    );
  });

  test('a cause that is itself an app failure reads as its description (Swift wraps the coordinator error again)', () => {
    const inner = new AppFailure({ kind: 'recordingFailed', cause: new RecordingError('alreadyRecording') });
    expect(problemDetail({ kind: 'recordingFailed', cause: inner })).toBe(
      'Recording failed: A recording is already running.',
    );
  });

  test('a cause that is not an Error reads as its text', () => {
    expect(problemDetail({ kind: 'recordingFailed', cause: 'disk full' })).toBe('disk full');
    expect(problemDetail({ kind: 'audioSessionFailed', cause: 42 })).toBe('42');
  });

  test('any other error shows its full description', () => {
    const error: AppError = { kind: 'microphonePermissionDenied' };
    expect(problemDetail(error)).toBe(errorDescription(error));
  });
});

describe('recordingErrorNotice', () => {
  const error: AppError = { kind: 'recordingFailed', cause: new RecordingError('trackStreamFailed') };
  const detail = "GPS tracking stopped. The rest of this flight's track will not be recorded.";

  test('while recording continues it is a caution about the audio', () => {
    expect(recordingErrorNotice(error, 'caution')).toEqual({
      title: 'Audio stopped',
      text: `Cockpit audio and transcript stopped. The GPS track is still recording. ${detail}`,
    });
  });

  test('once recording has stopped it is a warning that nothing is running', () => {
    expect(recordingErrorNotice(error, 'warning')).toEqual({
      title: 'Recording failed',
      text: `Recording is not running. ${detail}`,
    });
  });
});

describe('fixed copy (verbatim from the Swift views)', () => {
  test('microphone notice', () => {
    expect(MICROPHONE_NOTICE).toEqual({
      title: 'Microphone is off',
      text: 'The GPS track still records. For cockpit audio, turn the microphone on in Settings \u203a Kanaf \u203a Microphone.',
      action: 'Open Settings',
    });
  });

  test('discarded recording notice', () => {
    expect(DISCARDED_NOTICE).toEqual({
      title: 'Recording not saved',
      text: 'No GPS position was recorded, so there is no flight to keep. Check that Location is on and the aircraft had a fix before starting.',
    });
  });

  test('stop confirmation', () => {
    expect(STOP_CONFIRMATION).toEqual({
      title: 'End recording?',
      message: 'Stops the GPS track, cockpit audio and transcript. The flight is saved to Flights.',
      confirm: 'End Recording',
      cancel: 'Cancel',
    });
  });
});
