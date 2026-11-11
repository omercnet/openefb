// What FlightDetailView does around its sections (efb-212/Views/Flights/FlightDetailView.swift): on appear it asks whether the
// on-device model can run and prewarms it, and loads the CVFR debrief; on disappear it frees the model. Swift has no test of the
// view; the cases follow its source, and the guards that have no Swift counterpart say so.
import { sampleCvfrDebrief } from '../../domain/debrief/cvfrFixture';
import type { CVFRDebrief } from '../../domain/debrief/cvfrDebrief';
import { FAKE_DEBRIEF, FakeDebriefEngine } from '../../domain/ports/debriefEngine';
import { createFlightDetailStore } from './flightDetailStore';

const cvfr = sampleCvfrDebrief();

function setup(over: { engine?: FakeDebriefEngine | null; loadCvfr?: () => Promise<CVFRDebrief | null> } = {}) {
  const engine = over.engine === undefined ? new FakeDebriefEngine({ kind: 'available' }) : over.engine;
  const loadCvfr = jest.fn(over.loadCvfr ?? (async () => cvfr));
  const store = createFlightDetailStore({ engine, loadCvfr });
  return { engine, store, loadCvfr };
}

describe('a new flight detail', () => {
  it('has no CVFR debrief yet, and does not know whether the model can run', () => {
    const { store } = setup();
    expect(store.getState()).toMatchObject({ cvfr: null, availability: { kind: 'unknown' } });
  });
});

describe('appear', () => {
  it('asks whether the model can run and prewarms it when it can', async () => {
    const { store, engine } = setup();
    void store.getState().appear();
    expect(engine!.availabilityChecks).toBe(1);
    expect(store.getState().availability).toEqual({ kind: 'available' });
    expect(engine!.prewarmCalls).toBe(1);
  });

  it('does not prewarm a model that cannot run, and shows why', () => {
    const { store, engine } = setup({
      engine: new FakeDebriefEngine({ kind: 'unavailable', reason: 'Apple Intelligence is not enabled.' }),
    });
    void store.getState().appear();
    expect(store.getState().availability).toEqual({
      kind: 'unavailable',
      reason: 'Apple Intelligence is not enabled.',
    });
    expect(engine!.prewarmCalls).toBe(0);
  });

  it('prewarms when an answer that takes time says the model can run, once', async () => {
    const engine = new FakeDebriefEngine({ kind: 'available' });
    const { store } = setup({ engine });
    jest.spyOn(engine, 'checkAvailability').mockImplementation(() => undefined); // the platform answers later
    void store.getState().appear();
    expect(engine.prewarmCalls).toBe(0);
    engine.emit({ availability: { kind: 'available' } });
    engine.emit({ isGenerating: false }); // another change: not another prewarm
    expect(engine.prewarmCalls).toBe(1);
  });

  it('does without an engine (Android, or the adapter is not there): nothing to ask, the CVFR debrief still loads', async () => {
    const { store, loadCvfr } = setup({ engine: null });
    await store.getState().appear();
    expect(store.getState().availability).toEqual({ kind: 'unknown' });
    expect(loadCvfr).toHaveBeenCalledTimes(1);
    expect(store.getState().cvfr).toBe(cvfr);
  });

  it('loads the CVFR debrief of the flight', async () => {
    const { store, loadCvfr } = setup();
    const appearing = store.getState().appear();
    expect(store.getState().cvfr).toBeNull();
    await appearing;
    expect(loadCvfr).toHaveBeenCalledTimes(1);
    expect(store.getState().cvfr).toBe(cvfr);
  });

  it('has no CVFR debrief for a flight outside Israel', async () => {
    const { store } = setup({ loadCvfr: async () => null });
    await store.getState().appear();
    expect(store.getState().cvfr).toBeNull();
  });

  it('has none when it cannot be loaded, and shows the rest of the flight (Swift loadBundled swallows its errors)', async () => {
    const { store } = setup({
      loadCvfr: async () => {
        throw new Error('the Israel database could not be opened');
      },
    });
    await store.getState().appear();
    expect(store.getState().cvfr).toBeNull();
  });

  it('loads again when the screen appears again (SwiftUI restarts a task with the view)', async () => {
    const { store, loadCvfr } = setup();
    await store.getState().appear();
    store.getState().disappear();
    await store.getState().appear();
    expect(loadCvfr).toHaveBeenCalledTimes(2);
  });
});

describe('disappear', () => {
  it('frees the model: the engine forgets its session and debrief', () => {
    const { store, engine } = setup();
    void store.getState().appear();
    engine!.emit({ completed: FAKE_DEBRIEF });
    store.getState().disappear();
    expect(engine!.discardCalls).toBe(1);
    expect(engine!.state.completed).toBeNull();
  });

  it('does without an engine', () => {
    const { store } = setup({ engine: null });
    expect(() => store.getState().disappear()).not.toThrow();
  });

  it('a CVFR debrief that arrives after it is ignored (JS-only: SwiftUI cancels the task)', async () => {
    const gate = Promise.withResolvers<CVFRDebrief | null>();
    const { store } = setup({ loadCvfr: () => gate.promise });
    const appearing = store.getState().appear();
    store.getState().disappear();
    gate.resolve(cvfr);
    await appearing;
    expect(store.getState().cvfr).toBeNull();
  });

  it('an old load does not overwrite the one of a newer appearance (JS-only)', async () => {
    const old = Promise.withResolvers<CVFRDebrief | null>();
    let calls = 0;
    const { store } = setup({ loadCvfr: () => (++calls === 1 ? old.promise : Promise.resolve(cvfr)) });
    const first = store.getState().appear();
    store.getState().disappear();
    await store.getState().appear();
    expect(store.getState().cvfr).toBe(cvfr);
    old.resolve(null);
    await first;
    expect(store.getState().cvfr).toBe(cvfr);
  });

  it('a model that answers after it does not get prewarmed (the memory would be held for nothing)', () => {
    const engine = new FakeDebriefEngine({ kind: 'available' });
    const { store } = setup({ engine });
    jest.spyOn(engine, 'checkAvailability').mockImplementation(() => undefined);
    void store.getState().appear();
    store.getState().disappear();
    engine.emit({ availability: { kind: 'available' } });
    expect(engine.prewarmCalls).toBe(0);
  });
});

describe('following the engine', () => {
  it('shows the availability the engine reports', () => {
    const { store, engine } = setup();
    engine!.emit({ availability: { kind: 'unavailable', reason: 'x' } });
    expect(store.getState().availability).toEqual({ kind: 'unavailable', reason: 'x' });
  });

  it('stops after dispose', () => {
    const { store, engine } = setup();
    store.getState().dispose();
    engine!.emit({ availability: { kind: 'available' } });
    expect(store.getState().availability).toEqual({ kind: 'unknown' });
  });
});
