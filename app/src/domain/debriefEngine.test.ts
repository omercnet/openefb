// Port of efb-212Tests/ServiceTests/DebriefAvailabilityTests.swift (9 cases, same names, inputs and expected strings).
// Engine behaviour beyond the reason mapping has no Swift tests (it needs a device with Apple Intelligence); the cases
// after the port are new.
import { openNodeSqliteDb } from '../../tests/support/nodeSqliteDb';
import { openRecordingDatabase, type DebriefRecord } from '../data/recording';
import type { FlightDebrief } from './debrief/types';
import {
  availabilityReasonMessage,
  DEBRIEF_SYSTEM_PROMPT,
  DebriefEngine,
  debriefErrorMessage,
  type AvailabilityStatus,
  type DebriefStore,
} from './debriefEngine';
import { AppFailure } from './errors';
import { DebriefError, FakeDebriefModel } from './ports/debriefModel';

// "Settings > Apple Intelligence & Siri" uses U+203A (single right-pointing angle quotation mark) in the Swift strings.
const SETTINGS_PATH = 'Settings \u203A Apple Intelligence & Siri';

describe('Debrief Availability Tests', () => {
  test('deviceNotEligible maps to device not supported message', () => {
    const msg = availabilityReasonMessage('deviceNotEligible');
    expect(msg).toBe('This iPad does not support Apple Intelligence.');
  });

  test("'not eligible' substring also maps to device not supported message", () => {
    const msg = availabilityReasonMessage('Device is not eligible for AI');
    expect(msg).toBe('This iPad does not support Apple Intelligence.');
  });

  test('appleIntelligenceNotEnabled maps to enable in Settings message', () => {
    const msg = availabilityReasonMessage('appleIntelligenceNotEnabled');
    expect(msg).toBe(`Apple Intelligence is not enabled. Turn it on in ${SETTINGS_PATH}.`);
  });

  test("'not enabled' substring also maps to enable in Settings message", () => {
    const msg = availabilityReasonMessage('Apple Intelligence is not enabled on this device');
    expect(msg).toBe(`Apple Intelligence is not enabled. Turn it on in ${SETTINGS_PATH}.`);
  });

  test('modelNotReady maps to still setting up message', () => {
    const msg = availabilityReasonMessage('modelNotReady');
    expect(msg).toBe('Apple Intelligence is still downloading its model. Try again later.');
  });

  test("'not ready' substring also maps to still setting up message", () => {
    const msg = availabilityReasonMessage('Model is not ready yet');
    expect(msg).toBe('Apple Intelligence is still downloading its model. Try again later.');
  });

  test('Unknown reason returns generic unavailable message', () => {
    const msg = availabilityReasonMessage('someUnknownReason');
    expect(msg).toBe('Debrief is unavailable right now.');
  });

  test('Empty reason string returns generic unavailable message', () => {
    const msg = availabilityReasonMessage('');
    expect(msg).toBe('Debrief is unavailable right now.');
  });

  test('AvailabilityStatus enum equality checks', () => {
    const unknown: AvailabilityStatus = { kind: 'unknown' };
    const available: AvailabilityStatus = { kind: 'available' };
    expect(unknown).toEqual({ kind: 'unknown' });
    expect(available).toEqual({ kind: 'available' });
    expect({ kind: 'unavailable', reason: 'test' }).toEqual({ kind: 'unavailable', reason: 'test' });
    expect(available).not.toEqual(unknown);
    expect({ kind: 'unavailable', reason: 'a' }).not.toEqual({ kind: 'unavailable', reason: 'b' });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Engine behaviour (no Swift tests): lifecycle, streaming, saving, and the races and failures a device can produce.
// ---------------------------------------------------------------------------------------------------------------

const FLIGHT = '11111111-1111-4111-8111-111111111111';
const NOW = 1_700_000_000_000;

const DEBRIEF: FlightDebrief = {
  narrativeSummary: 'A smooth local flight with one high approach.',
  phaseObservations: [
    { phase: 'takeoff', observations: ['Rotated at 55 knots.'], executedWell: true },
    { phase: 'approach', observations: ['High on short final.', 'Corrected at 300 feet.'], executedWell: false },
  ],
  improvements: ['Stabilize the approach earlier.'],
  overallRating: 4,
};

async function fixture() {
  const model = new FakeDebriefModel();
  const rdb = await openRecordingDatabase(openNodeSqliteDb());
  const signals: string[] = [];
  const engine = new DebriefEngine({
    model,
    telemetry: { signal: (name) => void signals.push(name) },
    now: () => NOW,
    newId: () => 'debrief-1',
  });
  return { engine, model, rdb, signals };
}

/** An engine whose model reported available, as FlightDetailView does on appear. */
async function ready() {
  const f = await fixture();
  f.engine.checkAvailability();
  return f;
}

describe('availability', () => {
  test('is unknown until it is checked', async () => {
    const { engine } = await fixture();
    expect(engine.availabilityStatus).toEqual({ kind: 'unknown' });
  });

  test('is available when the model says so', async () => {
    const { engine } = await fixture();
    engine.checkAvailability();
    expect(engine.availabilityStatus).toEqual({ kind: 'available' });
  });

  test.each([
    ['deviceNotEligible', 'This iPad does not support Apple Intelligence.'],
    [
      'appleIntelligenceNotEnabled',
      `Apple Intelligence is not enabled. Turn it on in ${'Settings \u203A Apple Intelligence & Siri'}.`,
    ],
    ['modelNotReady', 'Apple Intelligence is still downloading its model. Try again later.'],
    ['somethingNew', 'Debrief is unavailable right now.'],
  ])('unavailable because %s carries the pilot message', async (reason, message) => {
    const { engine, model } = await fixture();
    model.current = { kind: 'unavailable', reason };
    engine.checkAvailability();
    expect(engine.availabilityStatus).toEqual({ kind: 'unavailable', reason: message });
  });

  test('a model that throws is unavailable, not a crash (JS-only guard)', async () => {
    const { engine, model } = await fixture();
    model.availabilityError = new Error('bridge down');
    expect(() => engine.checkAvailability()).not.toThrow();
    expect(engine.availabilityStatus).toEqual({ kind: 'unavailable', reason: 'Debrief is unavailable right now.' });
  });

  test('is checked again on every call', async () => {
    const { engine, model } = await fixture();
    model.current = { kind: 'unavailable', reason: 'modelNotReady' };
    engine.checkAvailability();
    model.current = { kind: 'available' };
    engine.checkAvailability();
    expect(engine.availabilityStatus).toEqual({ kind: 'available' });
  });

  test('reports whether the platform offers the debrief at all', async () => {
    const { engine, model } = await fixture();
    expect(engine.offered).toBe(true);
    model.offered = false;
    expect(engine.offered).toBe(false);
  });
});

describe('prewarm', () => {
  test('opens nothing before availability is known', async () => {
    const { engine, model } = await fixture();
    engine.prewarm();
    expect(model.sessions).toHaveLength(0);
  });

  test('opens nothing while the model is unavailable', async () => {
    const { engine, model } = await fixture();
    model.current = { kind: 'unavailable', reason: 'modelNotReady' };
    engine.checkAvailability();
    engine.prewarm();
    expect(model.sessions).toHaveLength(0);
  });

  test('opens a session with the flight instructor prompt when the model is available', async () => {
    const { engine, model } = await ready();
    engine.prewarm();
    expect(model.sessions).toHaveLength(1);
    expect(model.sessions[0]?.instructions).toBe(DEBRIEF_SYSTEM_PROMPT);
  });

  test('a second prewarm keeps the session it has', async () => {
    const { engine, model } = await ready();
    engine.prewarm();
    engine.prewarm();
    expect(model.sessions).toHaveLength(1);
  });

  test('a session that cannot open is dropped quietly, and generate tries again', async () => {
    const { engine, model, rdb } = await ready();
    model.openError = new Error('model not loaded');
    expect(() => engine.prewarm()).not.toThrow();
    expect(model.sessions).toHaveLength(0);

    model.openError = null;
    const generating = engine.generateDebrief('prompt', rdb, FLIGHT);
    model.sessions[0]?.latest.resolve(DEBRIEF);
    await generating;

    expect(engine.completedDebrief).toEqual(DEBRIEF);
  });
});

describe('DEBRIEF_SYSTEM_PROMPT', () => {
  test('is the Swift flight instructor prompt', () => {
    expect(DEBRIEF_SYSTEM_PROMPT).toBe(
      "You are an experienced flight instructor reviewing a student pilot's VFR flight. " +
        'Provide constructive, specific feedback based on the flight data. ' +
        'Focus on safety, decision-making, and technique. ' +
        'Be encouraging but honest about areas for improvement.',
    );
  });
});

describe('generateDebrief', () => {
  test('streams partials, then the completed debrief, and saves it', async () => {
    const { engine, model, rdb, signals } = await ready();
    const states: string[] = [];
    engine.subscribe(() =>
      states.push(`${engine.isGenerating ? 'generating' : 'idle'}:${engine.partialDebrief?.narrativeSummary ?? '-'}`),
    );

    const generating = engine.generateDebrief('the prompt', rdb, FLIGHT);
    expect(engine.isGenerating).toBe(true);
    const session = model.sessions[0]!;
    expect(session.latest.prompt).toBe('the prompt');

    session.latest.onPartial({ narrativeSummary: 'A smooth' });
    expect(engine.partialDebrief).toEqual({ narrativeSummary: 'A smooth' });
    session.latest.onPartial({ narrativeSummary: 'A smooth local flight', improvements: [] });
    expect(engine.partialDebrief).toEqual({ narrativeSummary: 'A smooth local flight', improvements: [] });

    session.latest.resolve(DEBRIEF);
    await generating;

    expect(engine.isGenerating).toBe(false);
    expect(engine.completedDebrief).toEqual(DEBRIEF);
    expect(engine.error).toBeNull();
    expect(states[0]).toBe('generating:-');
    expect(states).toContain('generating:A smooth');
    expect(states[states.length - 1]).toBe('idle:A smooth local flight');

    const saved = await rdb.debrief(FLIGHT);
    expect(saved).toEqual({
      id: 'debrief-1',
      flightID: FLIGHT,
      narrativeSummary: DEBRIEF.narrativeSummary,
      phaseObservationsJSON: JSON.stringify([
        { executedWell: true, observations: ['Rotated at 55 knots.'], phase: 'takeoff' },
        { executedWell: false, observations: ['High on short final.', 'Corrected at 300 feet.'], phase: 'approach' },
      ]),
      improvementsJSON: JSON.stringify(['Stabilize the approach earlier.']),
      overallRating: 4,
      generatedAt: NOW,
      promptTokensEstimate: null,
      responseTokensEstimate: null,
    });
    expect(signals).toEqual(['Debrief.generated']);
  });

  test('opens the session itself when prewarm was not called', async () => {
    const { engine, model, rdb } = await ready();
    const generating = engine.generateDebrief('p', rdb, FLIGHT);
    expect(model.sessions).toHaveLength(1);
    model.sessions[0]?.latest.resolve(DEBRIEF);
    await generating;
  });

  test('uses the prewarmed session', async () => {
    const { engine, model, rdb } = await ready();
    engine.prewarm();
    const generating = engine.generateDebrief('p', rdb, FLIGHT);
    expect(model.sessions).toHaveLength(1);
    model.sessions[0]?.latest.resolve(DEBRIEF);
    await generating;
  });

  test('generating again on the same session clears the earlier debrief first', async () => {
    const { engine, model, rdb } = await ready();
    const first = engine.generateDebrief('p', rdb, FLIGHT);
    model.sessions[0]?.latest.resolve(DEBRIEF);
    await first;

    const second = engine.generateDebrief('p', rdb, FLIGHT);
    expect(engine.completedDebrief).toBeNull();
    expect(engine.partialDebrief).toBeNull();
    expect(model.sessions).toHaveLength(1);
    model.sessions[0]?.latest.resolve({ ...DEBRIEF, overallRating: 2 });
    await second;
    expect(engine.completedDebrief?.overallRating).toBe(2);
    expect((await rdb.debrief(FLIGHT))?.overallRating).toBe(2); // the new debrief replaces the saved one
  });

  test('a failed generation keeps what streamed, reports the error and saves nothing', async () => {
    const { engine, model, rdb, signals } = await ready();
    const generating = engine.generateDebrief('p', rdb, FLIGHT);
    const session = model.sessions[0]!;
    session.latest.onPartial({ narrativeSummary: 'Half a thought' });
    const failure = new Error('Exceeded model context window size');
    session.latest.reject(failure);
    await generating;

    expect(engine.error).toBe(failure);
    expect(engine.isGenerating).toBe(false);
    expect(engine.completedDebrief).toBeNull();
    expect(engine.partialDebrief).toEqual({ narrativeSummary: 'Half a thought' });
    expect(await rdb.debrief(FLIGHT)).toBeNull();
    expect(signals).toEqual([]);
  });

  test('Try Again clears the earlier error as soon as it starts', async () => {
    const { engine, model, rdb } = await ready();
    const failing = engine.generateDebrief('p', rdb, FLIGHT);
    model.sessions[0]?.latest.reject(new Error('first attempt failed'));
    await failing;
    expect(engine.error).not.toBeNull();

    const retrying = engine.generateDebrief('p', rdb, FLIGHT);

    expect(engine.error).toBeNull(); // while the second attempt is still running
    model.sessions[0]?.latest.resolve(DEBRIEF);
    await retrying;
    expect(engine.completedDebrief).toEqual(DEBRIEF);
  });

  test('a rejection that is not an Error is kept as one', async () => {
    const { engine, model, rdb } = await ready();
    const generating = engine.generateDebrief('p', rdb, FLIGHT);
    model.sessions[0]?.latest.reject('plain string');
    await generating;
    expect(engine.error).toBeInstanceOf(Error);
    expect(engine.error?.message).toBe('plain string');
  });

  test('an empty response surfaces the Swift message', async () => {
    const { engine, model, rdb } = await ready();
    const generating = engine.generateDebrief('p', rdb, FLIGHT);
    model.sessions[0]?.latest.reject(new DebriefError('emptyResponse'));
    await generating;
    expect(engine.error && debriefErrorMessage(engine.error)).toBe('The debrief came back empty. Try again.');
  });

  test('a session that cannot open is the Swift "did not start a session" failure', async () => {
    const { engine, model, rdb } = await ready();
    model.openError = new Error('no model');

    await engine.generateDebrief('p', rdb, FLIGHT);

    expect(engine.isGenerating).toBe(false);
    expect(engine.error).toBeInstanceOf(AppFailure);
    // The cause chain keeps the native failure for the logs: AppFailure > DebriefError > the original error.
    const wrapped = (engine.error as AppFailure).error;
    expect(wrapped.kind === 'debriefFailed' && wrapped.cause).toBeInstanceOf(DebriefError);
    expect(wrapped.kind === 'debriefFailed' && (wrapped.cause as DebriefError).cause).toBe(model.openError);
    expect(engine.error && debriefErrorMessage(engine.error)).toBe(
      'Debrief failed: Apple Intelligence did not start a session. Check Settings \u203A Apple Intelligence & Siri.',
    );
    expect(await rdb.debrief(FLIGHT)).toBeNull();
  });

  test('a save that fails keeps the completed debrief on screen, reports the error and sends no signal', async () => {
    const { engine, model, rdb, signals } = await ready();
    jest.spyOn(rdb, 'insertDebrief').mockRejectedValueOnce(new Error('disk full'));

    const generating = engine.generateDebrief('p', rdb, FLIGHT);
    model.sessions[0]?.latest.resolve(DEBRIEF);
    await generating;

    expect(engine.completedDebrief).toEqual(DEBRIEF);
    expect(engine.error?.message).toBe('disk full');
    expect(engine.isGenerating).toBe(false);
    expect(signals).toEqual([]);
  });

  test('a store that throws synchronously is the same failure', async () => {
    const { engine, model, rdb } = await ready();
    jest.spyOn(rdb, 'insertDebrief').mockImplementationOnce(() => {
      throw new Error('database closed');
    });
    const generating = engine.generateDebrief('p', rdb, FLIGHT);
    model.sessions[0]?.latest.resolve(DEBRIEF);
    await generating;
    expect(engine.error?.message).toBe('database closed');
    expect(engine.isGenerating).toBe(false);
  });

  test('a telemetry hook that throws changes nothing', async () => {
    const model = new FakeDebriefModel();
    const rdb = await openRecordingDatabase(openNodeSqliteDb());
    const engine = new DebriefEngine({
      model,
      telemetry: {
        signal: () => {
          throw new Error('telemetry down');
        },
      },
    });
    engine.checkAvailability();
    const generating = engine.generateDebrief('p', rdb, FLIGHT);
    model.sessions[0]?.latest.resolve(DEBRIEF);
    await generating;
    expect(engine.error).toBeNull();
    expect(engine.completedDebrief).toEqual(DEBRIEF);
  });

  test('works without a telemetry hook, a clock or an id source', async () => {
    const model = new FakeDebriefModel();
    const rdb = await openRecordingDatabase(openNodeSqliteDb());
    const engine = new DebriefEngine({ model });
    engine.checkAvailability();
    const generating = engine.generateDebrief('p', rdb, FLIGHT);
    model.sessions[0]?.latest.resolve(DEBRIEF);
    await generating;
    const saved = await rdb.debrief(FLIGHT);
    expect(saved?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(saved?.generatedAt).toBeGreaterThan(1_700_000_000_000);
  });

  test('a call while a debrief is generating is ignored (JS-only guard: one request per session)', async () => {
    const { engine, model, rdb } = await ready();
    const first = engine.generateDebrief('first', rdb, FLIGHT);
    await engine.generateDebrief('second', rdb, FLIGHT);

    expect(model.sessions[0]?.generations).toHaveLength(1);
    expect(engine.isGenerating).toBe(true);

    model.sessions[0]?.latest.resolve(DEBRIEF);
    await first;
    expect(engine.isGenerating).toBe(false);
  });
});

describe('discard', () => {
  test('cancels a generation in progress, releases the session and clears everything but availability', async () => {
    const { engine, model, rdb } = await ready();
    const generating = engine.generateDebrief('p', rdb, FLIGHT);
    const session = model.sessions[0]!;
    session.latest.onPartial({ narrativeSummary: 'so far' });

    engine.discard();

    expect(session.closeCount).toBe(1);
    expect(engine.isGenerating).toBe(false);
    expect(engine.partialDebrief).toBeNull();
    expect(engine.completedDebrief).toBeNull();
    expect(engine.error).toBeNull();
    expect(engine.availabilityStatus).toEqual({ kind: 'available' });

    session.latest.reject(new Error('cancelled')); // what the closed session does
    await generating;
    expect(engine.error).toBeNull(); // the cancellation is not an error for the next screen
  });

  test('later partials and a late result from the discarded generation touch no state', async () => {
    const { engine, model, rdb } = await ready();
    const generating = engine.generateDebrief('p', rdb, FLIGHT);
    const session = model.sessions[0]!;
    const stale = session.latest;

    engine.discard();
    stale.onPartial({ narrativeSummary: 'too late' });
    stale.resolve(DEBRIEF);
    await generating;

    expect(engine.partialDebrief).toBeNull();
    expect(engine.completedDebrief).toBeNull();
    expect(engine.isGenerating).toBe(false);
  });

  test('a debrief that finished just as the screen closed is still saved, as in Swift', async () => {
    const { engine, model, rdb } = await ready();
    const generating = engine.generateDebrief('p', rdb, FLIGHT);
    const stale = model.sessions[0]!.latest;

    engine.discard();
    stale.resolve(DEBRIEF);
    await generating;

    expect((await rdb.debrief(FLIGHT))?.narrativeSummary).toBe(DEBRIEF.narrativeSummary);
  });

  test('a generation started after a discard gets a fresh session and is not touched by the old one', async () => {
    const { engine, model, rdb } = await ready();
    const first = engine.generateDebrief('old', rdb, FLIGHT);
    const old = model.sessions[0]!.latest;
    engine.discard();

    const second = engine.generateDebrief('new', rdb, FLIGHT);
    expect(model.sessions).toHaveLength(2);
    expect(engine.isGenerating).toBe(true);

    old.onPartial({ narrativeSummary: 'stale partial' });
    old.reject(new Error('cancelled'));
    await first;
    expect(engine.partialDebrief).toBeNull();
    expect(engine.error).toBeNull();
    expect(engine.isGenerating).toBe(true); // the old generation's end does not end the new one

    model.sessions[1]?.latest.resolve({ ...DEBRIEF, overallRating: 5 });
    await second;
    expect(engine.completedDebrief?.overallRating).toBe(5);
    expect(engine.isGenerating).toBe(false);
  });

  test('clears a completed debrief and an error', async () => {
    const { engine, model, rdb } = await ready();
    const generating = engine.generateDebrief('p', rdb, FLIGHT);
    model.sessions[0]?.latest.resolve(DEBRIEF);
    await generating;
    engine.discard();
    expect(engine.completedDebrief).toBeNull();

    const failing = engine.generateDebrief('p', rdb, FLIGHT);
    model.sessions[1]?.latest.reject(new Error('x'));
    await failing;
    expect(engine.error).not.toBeNull();
    engine.discard();
    expect(engine.error).toBeNull();
  });

  test('releases the session once however often it is called, and survives a session that throws on close', async () => {
    const { engine, model } = await ready();
    engine.prewarm();
    const session = model.sessions[0]!;
    session.closeError = new Error('already gone');

    expect(() => engine.discard()).not.toThrow();
    expect(() => engine.discard()).not.toThrow();

    expect(session.closeCount).toBe(1);
  });

  test('is safe before anything started', async () => {
    const { engine } = await fixture();
    expect(() => engine.discard()).not.toThrow();
  });
});

describe('loadExistingDebrief', () => {
  test('leaves the screen as it is when the flight has no debrief', async () => {
    const { engine, rdb } = await ready();
    await engine.loadExistingDebrief(rdb, FLIGHT);
    expect(engine.completedDebrief).toBeNull();
    expect(engine.error).toBeNull();
  });

  test('rebuilds the saved debrief exactly', async () => {
    const { engine, model, rdb } = await ready();
    const generating = engine.generateDebrief('p', rdb, FLIGHT);
    model.sessions[0]?.latest.resolve(DEBRIEF);
    await generating;

    const reopened = new DebriefEngine({ model: new FakeDebriefModel() });
    await reopened.loadExistingDebrief(rdb, FLIGHT);

    expect(reopened.completedDebrief).toEqual(DEBRIEF);
    expect(reopened.isGenerating).toBe(false);
  });

  test('reports a store that cannot be read', async () => {
    const { engine, rdb } = await ready();
    jest.spyOn(rdb, 'debrief').mockRejectedValueOnce(new Error('database is locked'));
    await engine.loadExistingDebrief(rdb, FLIGHT);
    expect(engine.error?.message).toBe('database is locked');
    expect(engine.completedDebrief).toBeNull();
  });

  test('a load that finishes after a new generation started is dropped', async () => {
    const { engine, model, rdb } = await ready();
    const generating = engine.generateDebrief('p', rdb, FLIGHT);
    model.sessions[0]?.latest.resolve(DEBRIEF);
    await generating;
    engine.discard();

    const { promise: slow, resolve } = Promise.withResolvers<DebriefRecord | null>();
    const store: DebriefStore = { debrief: () => slow, insertDebrief: (record) => rdb.insertDebrief(record) };
    const loading = engine.loadExistingDebrief(store, FLIGHT);
    const regenerating = engine.generateDebrief('p', rdb, FLIGHT);
    resolve(await rdb.debrief(FLIGHT));
    await loading;

    expect(engine.completedDebrief).toBeNull(); // the generation owns the screen now
    model.sessions[1]?.latest.resolve({ ...DEBRIEF, overallRating: 1 });
    await regenerating;
    expect(engine.completedDebrief?.overallRating).toBe(1);
  });

  test('a load that finishes while a debrief is generating is dropped, so it never covers the streaming one', async () => {
    const { engine, model, rdb } = await ready();
    const { promise: slow, resolve } = Promise.withResolvers<DebriefRecord | null>();
    const store: DebriefStore = { debrief: () => slow, insertDebrief: (record) => rdb.insertDebrief(record) };

    const generating = engine.generateDebrief('p', rdb, FLIGHT); // starts first ...
    const loading = engine.loadExistingDebrief(store, FLIGHT); // ... and the load begins under the same epoch
    model.sessions[0]?.latest.onPartial({ narrativeSummary: 'streaming' });
    resolve({
      id: 'old',
      flightID: FLIGHT,
      narrativeSummary: 'an older debrief',
      phaseObservationsJSON: '[]',
      improvementsJSON: '[]',
      overallRating: 2,
      generatedAt: NOW,
      promptTokensEstimate: null,
      responseTokensEstimate: null,
    });
    await loading;

    expect(engine.completedDebrief).toBeNull();
    expect(engine.partialDebrief).toEqual({ narrativeSummary: 'streaming' });
    model.sessions[0]?.latest.resolve(DEBRIEF);
    await generating;
    expect(engine.completedDebrief).toEqual(DEBRIEF);
  });

  test('a load that finishes after discard is dropped', async () => {
    const { engine, rdb } = await ready();
    const { promise: slow, resolve } = Promise.withResolvers<DebriefRecord | null>();
    const store: DebriefStore = { debrief: () => slow, insertDebrief: (record) => rdb.insertDebrief(record) };

    const loading = engine.loadExistingDebrief(store, FLIGHT);
    engine.discard();
    resolve({
      id: 'x',
      flightID: FLIGHT,
      narrativeSummary: 'old',
      phaseObservationsJSON: '[]',
      improvementsJSON: '[]',
      overallRating: 3,
      generatedAt: NOW,
      promptTokensEstimate: null,
      responseTokensEstimate: null,
    });
    await loading;

    expect(engine.completedDebrief).toBeNull();
  });

  test('a load that fails after discard does not put an error on the next screen', async () => {
    const { engine, rdb } = await ready();
    const { promise: slow, reject } = Promise.withResolvers<DebriefRecord | null>();
    const store: DebriefStore = { debrief: () => slow, insertDebrief: (record) => rdb.insertDebrief(record) };
    const loading = engine.loadExistingDebrief(store, FLIGHT);
    engine.discard();
    reject(new Error('late failure'));
    await loading;
    expect(engine.error).toBeNull();
  });
});

describe('subscribe', () => {
  test('tells listeners about every change and stops when unsubscribed', async () => {
    const { engine, model, rdb } = await ready();
    const calls: number[] = [];
    const unsubscribe = engine.subscribe(() => calls.push(calls.length));

    const generating = engine.generateDebrief('p', rdb, FLIGHT);
    model.sessions[0]?.latest.resolve(DEBRIEF);
    await generating;
    const seen = calls.length;
    expect(seen).toBeGreaterThanOrEqual(3); // generating, completed, idle

    unsubscribe();
    engine.discard();
    expect(calls).toHaveLength(seen);
  });

  test('a listener that throws does not stop the others or the engine', async () => {
    const { engine, model, rdb } = await ready();
    const seen: string[] = [];
    engine.subscribe(() => {
      throw new Error('view unmounted');
    });
    engine.subscribe(() => seen.push('second'));

    const generating = engine.generateDebrief('p', rdb, FLIGHT);
    model.sessions[0]?.latest.resolve(DEBRIEF);
    await generating;

    expect(seen.length).toBeGreaterThan(0);
    expect(engine.completedDebrief).toEqual(DEBRIEF);
  });
});

describe('debriefErrorMessage', () => {
  test('shows an AppFailure the way the app shows that error', () => {
    const failure = new AppFailure({ kind: 'debriefFailed', cause: new Error('Exceeded the context window') });
    expect(debriefErrorMessage(failure)).toBe('Debrief failed: Exceeded the context window');
  });

  test('shows any other error by its message, as Swift localizedDescription did', () => {
    expect(debriefErrorMessage(new DebriefError('generationFailed', new Error('boom')))).toBe('Debrief failed: boom');
    expect(debriefErrorMessage(new Error('plain'))).toBe('plain');
  });
});
