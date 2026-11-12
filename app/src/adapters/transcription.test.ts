import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { openNodeSqliteDb } from '../../tests/support/nodeSqliteDb';
import { openRecordingDatabase } from '../data/recording';
import { FakeSpeechEngine, unavailableSpeechEngine, type SpeechEngineConfig } from '../domain/ports/speech';
import { flush } from '../domain/recording/testSupport';
import { TranscriptionSession } from '../domain/transcriptionSession';
import { createTranscriptionService, defaultSpeechEngine } from './transcription';

// The iOS engine looks its native module up with requireOptionalNativeModule, which finds nothing under Jest.
jest.mock('expo', () => ({ ...jest.requireActual('expo'), requireOptionalNativeModule: jest.fn(() => null) }));

// The Android engine reaches expo-speech-recognition, whose native half does not exist under Jest. This one refuses the
// microphone, which tells the Android engine apart from the others.
jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    isRecognitionAvailable: jest.fn(() => true),
    supportsOnDeviceRecognition: jest.fn(() => true),
    getPermissionsAsync: jest.fn(async () => ({ granted: false })),
    requestPermissionsAsync: jest.fn(async () => ({ granted: false })),
  },
}));

const config: SpeechEngineConfig = { locale: 'en-US', aviationTerms: [], regionTerms: [] };
const sink = { result: () => undefined, failure: () => undefined };

afterEach(() => jest.restoreAllMocks());

/** A KanafSpeech module whose start says the microphone is refused, which tells the iOS engine apart from the others. */
const refusingNative = {
  addListener: () => ({ remove: () => undefined }),
  isAvailable: async () => true,
  prepare: async () => undefined,
  start: async () => 'permissionDenied',
  stop: async () => undefined,
};

describe('defaultSpeechEngine', () => {
  test('is the SpeechAnalyzer engine on iOS', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    jest.mocked(requireOptionalNativeModule).mockReturnValueOnce(refusingNative);
    await expect(defaultSpeechEngine().start(config, sink)).rejects.toMatchObject({
      error: { kind: 'microphonePermissionDenied' },
    });
  });

  test('is unavailable on iOS where the native module is not linked', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    await expect(defaultSpeechEngine().start(config, sink)).rejects.toMatchObject({
      error: { kind: 'transcriptionUnavailable' },
    });
  });

  test('is the on-device recogniser engine on Android', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    jest.spyOn(Platform, 'Version', 'get').mockReturnValue(34);
    await expect(defaultSpeechEngine().start(config, sink)).rejects.toMatchObject({
      error: { kind: 'microphonePermissionDenied' },
    });
  });

  test('is the unavailable engine elsewhere', () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    expect(defaultSpeechEngine()).toBe(unavailableSpeechEngine);
  });
});

describe('createTranscriptionService', () => {
  test('wires the store and the given engine into a TranscriptionSession', async () => {
    const rdb = await openRecordingDatabase(openNodeSqliteDb());
    const engine = new FakeSpeechEngine();
    const service = createTranscriptionService({ store: rdb, engine });
    const flightID = '11111111-1111-4111-8111-111111111111';

    expect(service).toBeInstanceOf(TranscriptionSession);
    await service.startTranscription(flightID);
    engine.sink.result({
      text: 'tower',
      isFinal: true,
      runs: [{ text: 'tower', confidence: 0.9, start: 1, end: 2 }],
      range: { start: 1, end: 2 },
    });
    await flush();

    expect((await rdb.transcriptSegments(flightID)).map((s) => s.text)).toEqual(['tower']);
  });

  test('takes the engine of the platform when none is given', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const rdb = await openRecordingDatabase(openNodeSqliteDb());
    await expect(createTranscriptionService({ store: rdb }).startTranscription('flight-1')).rejects.toMatchObject({
      error: { kind: 'transcriptionUnavailable' },
    });
  });
});
