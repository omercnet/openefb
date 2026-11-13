// FakeDebriefEngine follows DebriefEngine.swift's state changes, so the screens' tests and the screenshot fixtures can lean on it.
import { FAKE_DEBRIEF, FakeDebriefEngine } from './debriefEngine';

describe('FakeDebriefEngine', () => {
  it('starts with the availability unknown and nothing generated', () => {
    expect(new FakeDebriefEngine().state).toEqual({
      availability: { kind: 'unknown' },
      isGenerating: false,
      partial: null,
      completed: null,
      error: null,
    });
  });

  it('checkAvailability fills in what the platform says, and tells the listeners', () => {
    const engine = new FakeDebriefEngine({ kind: 'unavailable', reason: 'Apple Intelligence is not enabled.' });
    const listener = jest.fn();
    engine.subscribe(listener);
    engine.checkAvailability();
    expect(engine.state.availability).toEqual({ kind: 'unavailable', reason: 'Apple Intelligence is not enabled.' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('prewarms only when the model is available (Swift guards on it)', () => {
    const unavailable = new FakeDebriefEngine({ kind: 'unavailable', reason: 'x' });
    unavailable.checkAvailability();
    unavailable.prewarm();
    expect(unavailable.prewarmCalls).toBe(0);

    const available = new FakeDebriefEngine();
    available.prewarm(); // not checked yet
    expect(available.prewarmCalls).toBe(0);
    available.checkAvailability();
    available.prewarm();
    expect(available.prewarmCalls).toBe(1);
  });

  it('generating streams the partial result, then completes, and is not generating afterwards', async () => {
    const gate = Promise.withResolvers<void>();
    const engine = new FakeDebriefEngine({ kind: 'available' }, null, async (self) => {
      self.emit({ partial: { narrativeSummary: 'A short' } });
      await gate.promise;
      return FAKE_DEBRIEF;
    });
    const running = engine.generateDebrief('the prompt', 'flight-1');
    expect(engine.state).toMatchObject({
      isGenerating: true,
      completed: null,
      partial: { narrativeSummary: 'A short' },
    });
    gate.resolve();
    await running;
    expect(engine.state).toMatchObject({ isGenerating: false, completed: FAKE_DEBRIEF, error: null });
    expect(engine.generated).toEqual([{ prompt: 'the prompt', flightId: 'flight-1' }]);
  });

  it('a generation that fails leaves the error, and is not generating', async () => {
    const engine = new FakeDebriefEngine({ kind: 'available' }, null, async () => {
      throw new Error('The model returned nothing.');
    });
    await engine.generateDebrief('p', 'flight-1');
    expect(engine.state.isGenerating).toBe(false);
    expect(engine.state.completed).toBeNull();
    expect(engine.state.error).toEqual(new Error('The model returned nothing.'));
  });

  it('generating again clears the earlier result and error first', async () => {
    const engine = new FakeDebriefEngine({ kind: 'available' }, null, async (self) => {
      self.emit({ partial: { improvements: ['x'] } });
      return FAKE_DEBRIEF;
    });
    engine.emit({ error: new Error('old'), completed: FAKE_DEBRIEF });
    await engine.generateDebrief('p', 'flight-1');
    expect(engine.state.error).toBeNull();
  });

  it('loadExistingDebrief shows the saved debrief, and leaves the state alone when there is none', async () => {
    const saved = new FakeDebriefEngine({ kind: 'available' }, FAKE_DEBRIEF);
    await saved.loadExistingDebrief('flight-1');
    expect(saved.state.completed).toEqual(FAKE_DEBRIEF);
    expect(saved.loaded).toEqual(['flight-1']);

    const none = new FakeDebriefEngine();
    await none.loadExistingDebrief('flight-1');
    expect(none.state.completed).toBeNull();
  });

  it('discard clears the debrief, the partial result and the error', async () => {
    const engine = new FakeDebriefEngine();
    engine.emit({ partial: { narrativeSummary: 'x' }, completed: FAKE_DEBRIEF, error: new Error('e') });
    engine.discard();
    expect(engine.state).toMatchObject({ partial: null, completed: null, error: null });
    expect(engine.discardCalls).toBe(1);
  });

  it('stops telling a listener that unsubscribed', () => {
    const engine = new FakeDebriefEngine();
    const listener = jest.fn();
    const unsubscribe = engine.subscribe(listener);
    unsubscribe();
    engine.checkAvailability();
    expect(listener).not.toHaveBeenCalled();
  });
});
