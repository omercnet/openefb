// SpeechEngine on expo-speech-recognition, for Android (Android SpeechRecognizer; the plan's choice for both platforms
// before the owner moved iOS to SpeechAnalyzer, see speechAnalyzer.ts). Recognition stays on the device: without an
// on-device recogniser the engine is unavailable rather than falling back to Google's cloud service, which would send
// cockpit audio off the phone (PRIVACY.md). Differences from Swift: docs/port-notes/A3.md.
import type { EventSubscription } from 'expo';
import { Platform } from 'react-native';
import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionErrorEvent,
  type ExpoSpeechRecognitionOptions,
  type ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';

import { AppFailure } from '../domain/errors';
import type { SpeechEngine, SpeechFailure } from '../domain/ports/speech';

/** What this adapter uses of ExpoSpeechRecognitionModule. */
export interface SpeechRecognitionModule {
  addListener(event: 'result', listener: (event: ExpoSpeechRecognitionResultEvent) => void): EventSubscription;
  addListener(event: 'error', listener: (event: ExpoSpeechRecognitionErrorEvent) => void): EventSubscription;
  addListener(event: 'end', listener: () => void): EventSubscription;
  getPermissionsAsync(): Promise<{ granted: boolean }>;
  requestPermissionsAsync(): Promise<{ granted: boolean }>;
  isRecognitionAvailable(): boolean;
  supportsOnDeviceRecognition(): boolean;
  start(options: ExpoSpeechRecognitionOptions): void;
  abort(): void;
}

/**
 * expo-speech-recognition creates a recogniser that is bound to the device (createOnDeviceSpeechRecognizer) only from
 * Android 13. Below that it uses the default recogniser and merely prefers offline, which on many phones means Google's
 * cloud service: cockpit audio would leave the device, against PRIVACY.md. So older Android has no transcription.
 */
export const MIN_ON_DEVICE_API_LEVEL = 33;

export interface RecognizerEngineOptions {
  /** Defaults to expo-speech-recognition's recognizer. */
  module?: SpeechRecognitionModule;
  /** Milliseconds, for stamping results (Android reports no audio times). Defaults to Date.now. */
  now?: () => number;
  /** Android API level; defaults to Platform.Version (a string on other platforms, which never qualifies). */
  apiLevel?: number | string;
}

/** How the session should treat a recogniser error code. */
function failureKind(code: string): SpeechFailure['kind'] {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
    case 'language-not-supported':
    case 'bad-grammar':
      return 'fatal';
    case 'no-speech':
    case 'speech-timeout':
      return 'ended'; // silence is not a failure
    default:
      return 'transient';
  }
}

export function createRecognizerEngine(options: RecognizerEngineOptions = {}): SpeechEngine {
  const now = options.now ?? Date.now;
  const apiLevel = options.apiLevel ?? Platform.Version;
  const recognizer: SpeechRecognitionModule = options.module ?? ExpoSpeechRecognitionModule;
  let subscriptions: EventSubscription[] = [];
  let permitted = false;

  function unsubscribe(): void {
    subscriptions.forEach((subscription) => subscription.remove());
    subscriptions = [];
  }

  return {
    async start(config, sink) {
      unsubscribe(); // a start without a stop

      // Whether transcription can work at all comes before asking for the microphone.
      const onDevice = typeof apiLevel === 'number' && apiLevel >= MIN_ON_DEVICE_API_LEVEL;
      if (!onDevice || !recognizer.isRecognitionAvailable() || !recognizer.supportsOnDeviceRecognition()) {
        throw new AppFailure({ kind: 'transcriptionUnavailable' });
      }
      if (!permitted) {
        let permission = await recognizer.getPermissionsAsync();
        if (!permission.granted) permission = await recognizer.requestPermissionsAsync();
        if (!permission.granted) throw new AppFailure({ kind: 'microphonePermissionDenied' });
        permitted = true;
      }

      // Android gives no audio times, so a result is placed by when it arrived: an utterance runs from its first
      // partial result to its final one. Times are seconds from this start, as the engine contract says.
      const began = now();
      let utteranceStart: number | null = null;
      subscriptions = [
        recognizer.addListener('result', (event) => {
          const best = event.results[0];
          if (!best || best.transcript.trim() === '') return;
          const at = (now() - began) / 1000;
          utteranceStart ??= at;
          if (!event.isFinal) {
            sink.result({ text: best.transcript, isFinal: false, runs: [], range: null });
            return;
          }
          // Confidence is 0 to 1, or -1 when the recogniser gives none.
          const confidence = best.confidence >= 0 && best.confidence <= 1 ? best.confidence : null;
          const range = { start: utteranceStart, end: at };
          sink.result({
            text: best.transcript,
            isFinal: true,
            runs: [{ text: best.transcript, confidence, ...range }],
            range,
          });
          utteranceStart = null;
        }),
        recognizer.addListener('error', (event) => {
          if (event.error === 'aborted') return; // our own stop
          sink.failure({ kind: failureKind(event.error), message: `${event.error}: ${event.message}` });
        }),
        // A recogniser session ends after an utterance (continuous mode needs Android 13) or after silence.
        recognizer.addListener('end', () => sink.failure({ kind: 'ended', message: 'recognition ended' })),
      ];
      try {
        recognizer.start({
          lang: config.locale,
          interimResults: true,
          continuous: true,
          requiresOnDeviceRecognition: true,
          addsPunctuation: true,
          contextualStrings: [...config.aviationTerms, ...config.regionTerms],
        });
      } catch (error) {
        unsubscribe();
        throw new AppFailure({ kind: 'audioSessionFailed', cause: error });
      }
    },

    async stop() {
      unsubscribe();
      try {
        recognizer.abort();
      } catch {
        // Nothing is running that could be aborted.
      }
    },
  };
}
