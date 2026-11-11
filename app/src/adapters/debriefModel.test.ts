import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { DebriefEngine } from '../domain/debriefEngine';
import { DebriefError } from '../domain/ports/debriefModel';
import { createDebriefModel } from './debriefModel';

// The iOS adapter looks its native module up with requireOptionalNativeModule, which finds nothing under Jest.
jest.mock('expo', () => ({ ...jest.requireActual('expo'), requireOptionalNativeModule: jest.fn(() => null) }));

/** A KanafDebrief module that is available, which tells the iOS adapter apart from the unavailable model. */
const availableNative = {
  addListener: () => ({ remove: () => undefined }),
  availability: () => ({ status: 'available' }),
  openSession: () => undefined,
  generate: async () => '',
  closeSession: () => undefined,
};

afterEach(() => jest.restoreAllMocks());

describe('createDebriefModel', () => {
  test('on iOS it is the FoundationModels adapter', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    jest.mocked(requireOptionalNativeModule).mockReturnValueOnce(availableNative);

    const model = createDebriefModel();

    expect(model.offered).toBe(true);
    expect(model.availability()).toEqual({ kind: 'available' });
  });

  test('on iOS without the native module it is offered but unavailable', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const model = createDebriefModel();
    expect(model.offered).toBe(true);
    expect(model.availability()).toEqual({ kind: 'unavailable', reason: 'moduleNotLinked' });
  });

  test.each(['android', 'web'] as const)(
    'on %s the debrief is not offered: unavailable, and no session can open (owner decision Q8)',
    (os) => {
      jest.replaceProperty(Platform, 'OS', os);
      const model = createDebriefModel();

      expect(model.offered).toBe(false);
      expect(model.availability()).toEqual({ kind: 'unavailable', reason: 'notOfferedOnThisPlatform' });
      expect(() => model.openSession('instructions')).toThrow(DebriefError);
    },
  );

  test('the engine reports the platform as not offering it, so the screen hides the feature', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const engine = new DebriefEngine({ model: createDebriefModel() });
    engine.checkAvailability();

    expect(engine.offered).toBe(false);
    expect(engine.availabilityStatus).toEqual({ kind: 'unavailable', reason: 'Debrief is unavailable right now.' });
  });

  test('the engine on Android never opens a session, even when asked to', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const engine = new DebriefEngine({ model: createDebriefModel() });
    engine.checkAvailability();
    engine.prewarm();

    await engine.generateDebrief(
      'prompt',
      { debrief: async () => null, insertDebrief: async () => undefined },
      'flight-1',
    );

    expect(engine.error).not.toBeNull();
    expect(engine.completedDebrief).toBeNull();
  });
});
