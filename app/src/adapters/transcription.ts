// The transcription service the app wires into RecordingCoordinator: TranscriptionSession over the speech engine of the
// platform. Swift constructed TranscriptionService(recordingDB:) in the same place.
import { Platform } from 'react-native';

import { unavailableSpeechEngine, type SpeechEngine } from '../domain/ports/speech';
import { TranscriptionSession, type TranscriptionSessionDeps } from '../domain/transcriptionSession';
import { createSpeechAnalyzerEngine } from './speechAnalyzer';
import { createRecognizerEngine } from './speechRecognizer';

/** SpeechAnalyzer on iOS, the on-device Android recogniser on Android, nothing elsewhere. */
export function defaultSpeechEngine(): SpeechEngine {
  switch (Platform.OS) {
    case 'ios':
      return createSpeechAnalyzerEngine();
    case 'android':
      return createRecognizerEngine();
    default:
      return unavailableSpeechEngine;
  }
}

export function createTranscriptionService(
  deps: Pick<TranscriptionSessionDeps, 'store'> & Partial<TranscriptionSessionDeps>,
): TranscriptionSession {
  return new TranscriptionSession({ ...deps, engine: deps.engine ?? defaultSpeechEngine() });
}
