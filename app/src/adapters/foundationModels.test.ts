import type { EventSubscription } from 'expo';

import { openNodeSqliteDb } from '../../tests/support/nodeSqliteDb';
import { openRecordingDatabase } from '../data/recording';
import type { FlightDebrief } from '../domain/debrief/types';
import { DebriefEngine, debriefErrorMessage } from '../domain/debriefEngine';
import { DebriefError, type PartialFlightDebrief } from '../domain/ports/debriefModel';
import {
  createFoundationModelsDebriefModel,
  type KanafDebriefModule,
  type NativeAvailability,
  type NativePartialEvent,
} from './foundationModels';

interface PendingNative {
  requestId: number;
  prompt: string;
  resolve(json: string): void;
  reject(error: unknown): void;
}

/** The KanafDebrief native module as the adapter sees it, driven by the test. */
class FakeKanafDebrief implements KanafDebriefModule {
  availabilityResult: NativeAvailability = { status: 'available' };
  availabilityError: unknown = null;
  opened: string[] = [];
  openError: unknown = null;
  closeCount = 0;
  /** When set, generate() throws it synchronously instead of returning a promise. */
  generateThrows: unknown = null;
  readonly generations: PendingNative[] = [];
  private readonly listeners = new Set<(event: NativePartialEvent) => void>();

  addListener(_event: 'onPartial', listener: (event: NativePartialEvent) => void): EventSubscription {
    this.listeners.add(listener);
    return { remove: () => void this.listeners.delete(listener) };
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  emit(event: NativePartialEvent): void {
    [...this.listeners].forEach((listener) => listener(event));
  }

  availability(): NativeAvailability {
    if (this.availabilityError !== null) throw this.availabilityError;
    return this.availabilityResult;
  }

  openSession(instructions: string): void {
    if (this.openError !== null) throw this.openError;
    this.opened.push(instructions);
  }

  generate(requestId: number, prompt: string): Promise<string> {
    if (this.generateThrows !== null) throw this.generateThrows;
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    this.generations.push({ requestId, prompt, resolve, reject });
    return promise;
  }

  closeSession(): void {
    this.closeCount += 1;
  }

  get latest(): PendingNative {
    const latest = this.generations[this.generations.length - 1];
    if (!latest) throw new Error('nothing was generated');
    return latest;
  }
}

const DEBRIEF: FlightDebrief = {
  narrativeSummary: 'A smooth local flight.',
  phaseObservations: [{ phase: 'takeoff', observations: ['Rotated at 55 knots.'], executedWell: true }],
  improvements: ['Stabilize the approach earlier.'],
  overallRating: 4,
};

describe('availability', () => {
  test('is offered on iOS and available when the module says so', () => {
    const model = createFoundationModelsDebriefModel(new FakeKanafDebrief());
    expect(model.offered).toBe(true);
    expect(model.availability()).toEqual({ kind: 'available' });
  });

  test('carries the platform reason when unavailable', () => {
    const native = new FakeKanafDebrief();
    native.availabilityResult = { status: 'unavailable', reason: 'appleIntelligenceNotEnabled' };
    expect(createFoundationModelsDebriefModel(native).availability()).toEqual({
      kind: 'unavailable',
      reason: 'appleIntelligenceNotEnabled',
    });
  });

  test('an unavailable answer without a reason has an empty reason', () => {
    const native = new FakeKanafDebrief();
    native.availabilityResult = { status: 'unavailable' };
    expect(createFoundationModelsDebriefModel(native).availability()).toEqual({ kind: 'unavailable', reason: '' });
  });

  test('a status it does not know is unavailable, never available', () => {
    const native = new FakeKanafDebrief();
    native.availabilityResult = { status: 'maybe' } as unknown as NativeAvailability;
    expect(createFoundationModelsDebriefModel(native).availability().kind).toBe('unavailable');
  });

  test('without the native module it is unavailable', () => {
    const model = createFoundationModelsDebriefModel(null);
    expect(model.offered).toBe(true);
    expect(model.availability()).toEqual({ kind: 'unavailable', reason: 'moduleNotLinked' });
  });

  test('a native failure is left to the engine, which reads it as unavailable', () => {
    const native = new FakeKanafDebrief();
    native.availabilityError = new Error('bridge down');
    expect(() => createFoundationModelsDebriefModel(native).availability()).toThrow('bridge down');
  });
});

describe('openSession', () => {
  test('opens a native session with the instructions', () => {
    const native = new FakeKanafDebrief();
    createFoundationModelsDebriefModel(native).openSession('be a flight instructor');
    expect(native.opened).toEqual(['be a flight instructor']);
  });

  test('without the native module it cannot open one', () => {
    expect(() => createFoundationModelsDebriefModel(null).openSession('x')).toThrow(DebriefError);
  });

  test('a native failure to open is passed on', () => {
    const native = new FakeKanafDebrief();
    native.openError = new Error('no model');
    expect(() => createFoundationModelsDebriefModel(native).openSession('x')).toThrow('no model');
  });
});

describe('generate', () => {
  function session() {
    const native = new FakeKanafDebrief();
    return { native, session: createFoundationModelsDebriefModel(native).openSession('instructions') };
  }

  test('sends the prompt, streams partials and returns the validated debrief', async () => {
    const { native, session: s } = session();
    const partials: PartialFlightDebrief[] = [];

    const generating = s.generate('the prompt', (partial) => partials.push(partial));
    expect(native.latest.prompt).toBe('the prompt');
    native.emit({ requestId: native.latest.requestId, json: '{"narrativeSummary":"A smooth"}' });
    native.emit({
      requestId: native.latest.requestId,
      json: '{"narrativeSummary":"A smooth local flight.","improvements":[]}',
    });
    native.latest.resolve(JSON.stringify(DEBRIEF));

    expect(await generating).toEqual(DEBRIEF);
    expect(partials).toEqual([
      { narrativeSummary: 'A smooth' },
      { narrativeSummary: 'A smooth local flight.', improvements: [] },
    ]);
  });

  test('every generation has its own request id', async () => {
    const { native, session: s } = session();
    const first = s.generate('a', () => undefined);
    native.latest.resolve(JSON.stringify(DEBRIEF));
    await first;
    const second = s.generate('b', () => undefined);
    expect(new Set(native.generations.map((g) => g.requestId)).size).toBe(2);
    native.latest.resolve(JSON.stringify(DEBRIEF));
    await second;
  });

  test('events of another request are ignored', async () => {
    const { native, session: s } = session();
    const partials: PartialFlightDebrief[] = [];
    const generating = s.generate('p', (partial) => partials.push(partial));

    native.emit({ requestId: native.latest.requestId + 100, json: '{"narrativeSummary":"someone else"}' });
    native.latest.resolve(JSON.stringify(DEBRIEF));
    await generating;

    expect(partials).toEqual([]);
  });

  test('a snapshot that cannot be read is skipped and the next one still arrives', async () => {
    const { native, session: s } = session();
    const partials: PartialFlightDebrief[] = [];
    const generating = s.generate('p', (partial) => partials.push(partial));

    native.emit({ requestId: native.latest.requestId, json: '{"narrativeSummary": "A smo' });
    native.emit({ requestId: native.latest.requestId, json: '{"narrativeSummary":"A smooth"}' });
    native.latest.resolve(JSON.stringify(DEBRIEF));
    await generating;

    expect(partials).toEqual([{ narrativeSummary: 'A smooth' }]);
  });

  test('stops listening when the generation ends, however it ends', async () => {
    const { native, session: s } = session();

    const ok = s.generate('p', () => undefined);
    expect(native.listenerCount).toBe(1);
    native.latest.resolve(JSON.stringify(DEBRIEF));
    await ok;
    expect(native.listenerCount).toBe(0);

    const failed = s.generate('p', () => undefined);
    native.latest.reject(new Error('Exceeded model context window size'));
    await expect(failed).rejects.toThrow('Exceeded model context window size');
    expect(native.listenerCount).toBe(0);

    const malformed = s.generate('p', () => undefined);
    native.latest.resolve('{}');
    await expect(malformed).rejects.toThrow(DebriefError);
    expect(native.listenerCount).toBe(0);
  });

  test('the native rejection is passed on as it came (the pilot sees its message)', async () => {
    const { native, session: s } = session();
    const failure = Object.assign(new Error('The model refused the request'), { code: 'ERR_DEBRIEF_GENERATION' });
    const generating = s.generate('p', () => undefined);
    native.latest.reject(failure);
    await expect(generating).rejects.toBe(failure);
  });

  test('a rejection that is not an Error is turned into one', async () => {
    const { native, session: s } = session();
    const generating = s.generate('p', () => undefined);
    native.latest.reject('plain string');
    await expect(generating).rejects.toThrow('plain string');
  });

  test('a native call that throws at once rejects, and nothing is left listening', async () => {
    const { native, session: s } = session();
    native.generateThrows = new Error('session closed natively');
    await expect(s.generate('p', () => undefined)).rejects.toThrow('session closed natively');
    expect(native.listenerCount).toBe(0);
  });

  test.each([
    ['an empty string', ''],
    ['blank text', '  \n'],
    ['no value', undefined],
    ['a number', 5],
  ])('%s from the module is the empty-response failure', async (_name, result) => {
    const { native, session: s } = session();
    const generating = s.generate('p', () => undefined);
    native.latest.resolve(result as unknown as string);
    await expect(generating).rejects.toMatchObject({ kind: 'emptyResponse' });
  });

  test.each([
    ['text that is not JSON', 'Here is your debrief'],
    ['an object missing fields', '{"narrativeSummary":"x"}'],
    ['a rating out of range', JSON.stringify({ ...DEBRIEF, overallRating: 9 })],
  ])('%s is a malformed response', async (_name, text) => {
    const { native, session: s } = session();
    const generating = s.generate('p', () => undefined);
    native.latest.resolve(text);
    await expect(generating).rejects.toMatchObject({ kind: 'malformedResponse' });
  });
});

describe('close', () => {
  test('releases the native session once however often it is called', () => {
    const native = new FakeKanafDebrief();
    const s = createFoundationModelsDebriefModel(native).openSession('x');
    s.close();
    s.close();
    expect(native.closeCount).toBe(1);
  });

  test('a closed session refuses to generate and never reaches the module', async () => {
    const native = new FakeKanafDebrief();
    const s = createFoundationModelsDebriefModel(native).openSession('x');
    s.close();
    await expect(s.generate('p', () => undefined)).rejects.toMatchObject({ kind: 'sessionUnavailable' });
    expect(native.generations).toHaveLength(0);
  });

  test('closing during a generation stops the stream at once and the cancelled call rejects', async () => {
    const native = new FakeKanafDebrief();
    const s = createFoundationModelsDebriefModel(native).openSession('x');
    const partials: PartialFlightDebrief[] = [];
    const generating = s.generate('p', (partial) => partials.push(partial));
    const requestId = native.latest.requestId;

    s.close();
    expect(native.listenerCount).toBe(0); // nothing more is delivered
    native.emit({ requestId, json: '{"narrativeSummary":"late"}' });
    native.latest.reject(Object.assign(new Error('The debrief was cancelled'), { code: 'ERR_DEBRIEF_CANCELLED' }));

    await expect(generating).rejects.toThrow('The debrief was cancelled');
    expect(partials).toEqual([]);
    expect(native.closeCount).toBe(1);
  });
});

describe('with DebriefEngine', () => {
  async function flight() {
    const native = new FakeKanafDebrief();
    const rdb = await openRecordingDatabase(openNodeSqliteDb());
    const engine = new DebriefEngine({
      model: createFoundationModelsDebriefModel(native),
      now: () => 1_700_000_000_000,
    });
    engine.checkAvailability();
    return { native, rdb, engine };
  }
  const FLIGHT = '11111111-1111-4111-8111-111111111111';

  test('availability, prewarm, generate and save work through the module', async () => {
    const { native, rdb, engine } = await flight();
    expect(engine.availabilityStatus).toEqual({ kind: 'available' });

    engine.prewarm();
    expect(native.opened).toHaveLength(1);

    const generating = engine.generateDebrief('prompt', rdb, FLIGHT);
    native.emit({ requestId: native.latest.requestId, json: '{"narrativeSummary":"A smooth"}' });
    expect(engine.partialDebrief).toEqual({ narrativeSummary: 'A smooth' });
    native.latest.resolve(JSON.stringify(DEBRIEF));
    await generating;

    expect(engine.completedDebrief).toEqual(DEBRIEF);
    expect((await rdb.debrief(FLIGHT))?.overallRating).toBe(4);
  });

  test('a malformed answer shows the pilot a message and saves nothing', async () => {
    const { native, rdb, engine } = await flight();
    const generating = engine.generateDebrief('prompt', rdb, FLIGHT);
    native.latest.resolve('{"nope":true}');
    await generating;

    expect(engine.error && debriefErrorMessage(engine.error)).toBe(
      'The debrief came back in a form the app could not read. Try again.',
    );
    expect(await rdb.debrief(FLIGHT)).toBeNull();
  });

  test('discard cancels the native generation and the cancelled call leaves no error behind', async () => {
    const { native, rdb, engine } = await flight();
    const generating = engine.generateDebrief('prompt', rdb, FLIGHT);

    engine.discard();
    native.latest.reject(new Error('The debrief was cancelled'));
    await generating;

    expect(native.closeCount).toBe(1);
    expect(engine.error).toBeNull();
    expect(engine.isGenerating).toBe(false);
  });

  test('an unavailable model reads as the pilot message', async () => {
    const native = new FakeKanafDebrief();
    native.availabilityResult = { status: 'unavailable', reason: 'deviceNotEligible' };
    const engine = new DebriefEngine({ model: createFoundationModelsDebriefModel(native) });
    engine.checkAvailability();
    expect(engine.availabilityStatus).toEqual({
      kind: 'unavailable',
      reason: 'This iPad does not support Apple Intelligence.',
    });
  });
});
