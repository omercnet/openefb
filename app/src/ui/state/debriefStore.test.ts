// The AI debrief screen's state (efb-212/Views/Flights/DebriefView.swift) over the DebriefEngine port and a fake engine: what the
// view reads (the engine's state and the error from building the prompt), and what its buttons do. Swift has no test of the view;
// the cases follow its source, and the guards that have no Swift counterpart say so.
import { FAKE_DEBRIEF, FakeDebriefEngine, type PartialFlightDebrief } from '../../domain/ports/debriefEngine';
import { flush } from '../../domain/recording/testSupport';
import { debriefPane } from '../../domain/debrief/debriefView';
import { createDebriefStore } from './debriefStore';

function setup(over: { engine?: FakeDebriefEngine; buildPrompt?: () => Promise<string> } = {}) {
  const engine = over.engine ?? new FakeDebriefEngine({ kind: 'available' });
  const buildPrompt = jest.fn(over.buildPrompt ?? (async () => 'the prompt'));
  const store = createDebriefStore({ engine, flightId: 'flight-1', buildPrompt });
  const pane = () => debriefPane(store.getState());
  return { engine, store, buildPrompt, pane };
}

describe('a new debrief screen', () => {
  it('has nothing yet, and shows the first pane', () => {
    const { store, pane } = setup();
    expect(store.getState()).toMatchObject({
      isGenerating: false,
      partial: null,
      completed: null,
      engineError: null,
      promptError: null,
    });
    expect(pane()).toBe('initial');
  });

  it('starts from what the engine already holds (a debrief loaded earlier)', () => {
    const engine = new FakeDebriefEngine({ kind: 'available' });
    engine.emit({ completed: FAKE_DEBRIEF });
    const { store } = setup({ engine });
    expect(store.getState().completed).toBe(FAKE_DEBRIEF);
  });
});

describe('loadExisting (onAppear)', () => {
  it('asks the engine for the flight debrief saved earlier, and shows it', async () => {
    const { store, engine, pane } = setup({ engine: new FakeDebriefEngine({ kind: 'available' }, FAKE_DEBRIEF) });
    await store.getState().loadExisting();
    expect(engine.loaded).toEqual(['flight-1']);
    expect(store.getState().completed).toEqual(FAKE_DEBRIEF);
    expect(pane()).toBe('completed');
  });

  it('shows the first pane for a flight with no saved debrief', async () => {
    const { store, pane } = setup();
    await store.getState().loadExisting();
    expect(pane()).toBe('initial');
  });

  it('an engine that fails to load is shown as a debrief failure (JS-only: the Swift engine stores its own error)', async () => {
    const { store, engine, pane } = setup();
    jest.spyOn(engine, 'loadExistingDebrief').mockRejectedValueOnce(new Error('disk I/O error'));
    await store.getState().loadExisting();
    expect(pane()).toBe('error');
    expect(store.getState().promptError).toMatchObject({ kind: 'debriefFailed' });
  });
});

describe('generate', () => {
  it('builds the prompt, gives it to the engine with the flight, and shows the finished debrief', async () => {
    const { store, engine, buildPrompt, pane } = setup();
    await store.getState().generate();
    expect(buildPrompt).toHaveBeenCalledTimes(1);
    expect(engine.generated).toEqual([{ prompt: 'the prompt', flightId: 'flight-1' }]);
    expect(store.getState()).toMatchObject({ completed: FAKE_DEBRIEF, isGenerating: false, promptError: null });
    expect(pane()).toBe('completed');
  });

  it('streams: the partial result shows while the engine is generating, then the finished debrief', async () => {
    const gate = Promise.withResolvers<void>();
    const engine = new FakeDebriefEngine({ kind: 'available' }, null, async (self) => {
      self.emit({ partial: { narrativeSummary: 'A short pattern' } });
      await gate.promise;
      return FAKE_DEBRIEF;
    });
    const { store, pane } = setup({ engine });
    const running = store.getState().generate();
    await flush();
    expect(store.getState()).toMatchObject({ isGenerating: true, partial: { narrativeSummary: 'A short pattern' } });
    expect(pane()).toBe('streaming');
    gate.resolve();
    await running;
    expect(pane()).toBe('completed');
  });

  it('a prompt that cannot be built is a debrief failure the pilot can retry; the engine is not asked', async () => {
    let failing = true;
    const { store, engine, pane } = setup({
      buildPrompt: async () => {
        if (failing) throw new Error('disk I/O error');
        return 'the prompt';
      },
    });
    await store.getState().generate();
    expect(engine.generated).toHaveLength(0);
    expect(pane()).toBe('error');
    expect(store.getState().promptError).toMatchObject({ kind: 'debriefFailed' });

    failing = false;
    await store.getState().generate();
    expect(store.getState().promptError).toBeNull();
    expect(pane()).toBe('completed');
  });

  it('an engine that fails shows its error, and Try Again clears it', async () => {
    let failing = true;
    const engine = new FakeDebriefEngine({ kind: 'available' }, null, async () => {
      if (failing) throw new Error('The model returned nothing.');
      return FAKE_DEBRIEF;
    });
    const { store, pane } = setup({ engine });
    await store.getState().generate();
    expect(pane()).toBe('error');
    expect(store.getState().engineError).toEqual(new Error('The model returned nothing.'));

    failing = false;
    await store.getState().generate();
    expect(store.getState().engineError).toBeNull();
    expect(pane()).toBe('completed');
  });

  it('an engine that rejects instead of recording its error is shown the same way (JS-only guard)', async () => {
    const { store, engine, pane } = setup();
    jest.spyOn(engine, 'generateDebrief').mockRejectedValueOnce(new Error('the adapter crashed'));
    await store.getState().generate();
    expect(pane()).toBe('error');
    expect(store.getState().promptError).toMatchObject({ kind: 'debriefFailed' });
  });

  it('a second tap while the prompt is being built or the debrief generated is ignored (JS-only: Swift would start a second stream)', async () => {
    const gate = Promise.withResolvers<string>();
    const { store, engine, buildPrompt } = setup({ buildPrompt: () => gate.promise });
    const first = store.getState().generate();
    await store.getState().generate(); // building the prompt
    gate.resolve('the prompt');
    await first;
    expect(buildPrompt).toHaveBeenCalledTimes(1);

    const running = Promise.withResolvers<void>();
    engine.script = async () => {
      await running.promise;
      return FAKE_DEBRIEF;
    };
    const second = store.getState().generate();
    await flush();
    await store.getState().generate(); // generating
    running.resolve();
    await second;
    expect(engine.generated).toHaveLength(2); // the first, and the second: not a third
  });

  it('can be run again once it has finished', async () => {
    const { store, engine } = setup();
    await store.getState().generate();
    await store.getState().generate();
    expect(engine.generated).toHaveLength(2);
  });
});

describe('regenerate', () => {
  it('clears the debrief on the engine, then generates a new one', async () => {
    const { store, engine, pane } = setup({ engine: new FakeDebriefEngine({ kind: 'available' }, FAKE_DEBRIEF) });
    await store.getState().loadExisting();
    await store.getState().regenerate();
    expect(engine.discardCalls).toBe(1);
    expect(engine.generated).toEqual([{ prompt: 'the prompt', flightId: 'flight-1' }]);
    expect(pane()).toBe('completed');
  });

  it('does not clear a debrief that is being generated (JS-only guard)', async () => {
    const gate = Promise.withResolvers<string>();
    const { store, engine } = setup({ buildPrompt: () => gate.promise });
    const first = store.getState().generate();
    await store.getState().regenerate();
    expect(engine.discardCalls).toBe(0);
    gate.resolve('the prompt');
    await first;
  });

  it('forgets a prompt error when it discards, as the engine forgets its error', async () => {
    let failing = true;
    const { store } = setup({
      buildPrompt: async () => {
        if (failing) throw new Error('disk');
        return 'the prompt';
      },
    });
    await store.getState().generate();
    failing = false;
    await store.getState().regenerate();
    expect(store.getState().promptError).toBeNull();
  });
});

describe('following the engine', () => {
  it('shows every part of the stream as it arrives', async () => {
    const parts: PartialFlightDebrief[] = [
      { narrativeSummary: 'A short' },
      { narrativeSummary: 'A short pattern flight', phaseObservations: [{ phase: 'takeoff' }] },
      {
        narrativeSummary: 'A short pattern flight',
        phaseObservations: [{ phase: 'takeoff', executedWell: true }],
        overallRating: 4,
      },
    ];
    const seen: (PartialFlightDebrief | null)[] = [];
    const engine = new FakeDebriefEngine({ kind: 'available' }, null, async (self) => {
      for (const part of parts) {
        self.emit({ partial: part });
        await flush();
      }
      return FAKE_DEBRIEF;
    });
    const { store } = setup({ engine });
    store.subscribe((state) => seen.push(state.partial));
    await store.getState().generate();
    expect(seen).toEqual(expect.arrayContaining(parts));
  });

  it('stops following the engine after dispose', () => {
    const { store, engine } = setup();
    store.getState().dispose();
    engine.emit({ completed: FAKE_DEBRIEF });
    expect(store.getState().completed).toBeNull();
  });
});
