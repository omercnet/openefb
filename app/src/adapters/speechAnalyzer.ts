// SpeechEngine on the local KanafSpeech Expo module (modules/kanaf-speech): iOS 26 SpeechAnalyzer fed by an AVAudioEngine
// microphone tap, as in Swift. expo-speech-recognition 58 wraps SFSpeechRecognizer only, so this is the small local
// module the plan's risk R4 allows. Differences from Swift: docs/port-notes/A3.md.
import { requireOptionalNativeModule, type EventSubscription } from 'expo';

import { AppFailure } from '../domain/errors';
import { TRANSCRIPTION_LOCALE, type SpeechEngine, type SpeechResult } from '../domain/ports/speech';

/** What start() reports. Anything but 'started' means nothing is running. */
export type NativeStartStatus = 'started' | 'unavailable' | 'unsupportedLocale' | 'assetsMissing' | 'permissionDenied';

export interface NativeRun {
  text: string;
  confidence?: number;
  start?: number;
  end?: number;
}

export interface NativeResultEvent {
  text: string;
  isFinal: boolean;
  /** Final results only. */
  runs?: NativeRun[];
  rangeStart?: number;
  rangeEnd?: number;
}

/** The analyzer or the audio engine stopped working. Another start may fix it, so the session retries before giving up. */
export interface NativeFailureEvent {
  message: string;
}

/** What the native module offers, as far as this adapter uses it. */
export interface KanafSpeechModule {
  addListener(event: 'onResult', listener: (event: NativeResultEvent) => void): EventSubscription;
  addListener(event: 'onFailure', listener: (event: NativeFailureEvent) => void): EventSubscription;
  /** iOS 26 or later, the locale is supported and its speech assets are installed. */
  isAvailable(locale: string): Promise<boolean>;
  /** Downloads and installs the locale's speech assets if they are missing. Needs the network. */
  prepare(locale: string): Promise<void>;
  start(options: { locale: string; contextualStrings: string[] }): Promise<NativeStartStatus>;
  stop(): Promise<void>;
}

/** The native module, or null where it is not linked (Android, web, a binary built without it). */
export function loadKanafSpeech(): KanafSpeechModule | null {
  return requireOptionalNativeModule<KanafSpeechModule>('KanafSpeech');
}

const finiteOrNull = (value: number | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function toResult(event: NativeResultEvent): SpeechResult {
  const start = finiteOrNull(event.rangeStart);
  const end = finiteOrNull(event.rangeEnd);
  return {
    text: event.text,
    isFinal: event.isFinal,
    runs: (event.runs ?? []).map((run) => ({
      text: run.text,
      confidence: finiteOrNull(run.confidence),
      start: finiteOrNull(run.start),
      end: finiteOrNull(run.end),
    })),
    range: start !== null && end !== null ? { start, end } : null,
  };
}

export function createSpeechAnalyzerEngine(native: KanafSpeechModule | null = loadKanafSpeech()): SpeechEngine {
  let subscriptions: EventSubscription[] = [];

  function unsubscribe(): void {
    subscriptions.forEach((subscription) => subscription.remove());
    subscriptions = [];
  }

  /** Native stop never matters more than the error being reported, so its own failure is dropped. */
  async function stopNative(native: KanafSpeechModule): Promise<void> {
    try {
      await native.stop();
    } catch {
      // Nothing more can be done for a session the platform will not stop.
    }
  }

  return {
    async start(config, sink) {
      if (!native) throw new AppFailure({ kind: 'transcriptionUnavailable' });
      unsubscribe(); // a start without a stop
      // Listen before starting so no early result is missed.
      subscriptions = [
        native.addListener('onResult', (event) => sink.result(toResult(event))),
        native.addListener('onFailure', (event) => sink.failure({ kind: 'transient', message: event.message })),
      ];
      try {
        // Swift gave SpeechAnalyzer only the region terms as contextual strings; the radio terms went to SFSpeechRecognizer.
        const status = await native.start({ locale: config.locale, contextualStrings: [...config.regionTerms] });
        if (status !== 'started') {
          // The failures the recording coordinator already handles: no microphone access, or no recogniser.
          throw new AppFailure(
            status === 'permissionDenied'
              ? { kind: 'microphonePermissionDenied' }
              : { kind: 'transcriptionUnavailable' },
          );
        }
      } catch (error) {
        unsubscribe();
        await stopNative(native);
        throw error instanceof AppFailure ? error : new AppFailure({ kind: 'audioSessionFailed', cause: error });
      }
    },

    async stop() {
      unsubscribe();
      if (native) await stopNative(native);
    },
  };
}

/** Downloads the speech assets for the transcription locale if they are missing; call it once, with network, before a flight. */
export async function prepareSpeechAssets(native: KanafSpeechModule | null = loadKanafSpeech()): Promise<void> {
  if (!native) throw new AppFailure({ kind: 'transcriptionUnavailable' });
  await native.prepare(TRANSCRIPTION_LOCALE);
}

/** Whether SpeechAnalyzer can transcribe now: iOS 26, supported locale, assets installed. */
export async function isSpeechAnalyzerAvailable(
  native: KanafSpeechModule | null = loadKanafSpeech(),
): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.isAvailable(TRANSCRIPTION_LOCALE);
  } catch {
    return false;
  }
}
