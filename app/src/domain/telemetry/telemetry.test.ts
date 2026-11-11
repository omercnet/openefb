// The usage counters as the app sees them (Swift: the `Telemetry` enum of Services/TelemetryService.swift, which fed TelemetryDeck):
// signal() counts, flush() sends, setEnabled() is the Settings toggle "Share anonymous usage data". The Swift file has no tests
// for these parts (its four cases are about MetricKit and are dropped, see docs/port-notes/A5.md), so everything here is new.
import type { DebriefEngineDeps } from '../debriefEngine';
import { FakeTelemetryStorage, FakeTelemetryTransport } from '../ports/telemetry';
import { MAX_BUFFER_KEYS, parseRows, serializeRows } from './counterBuffer';
import type { CounterRow } from './schema';
import { MAX_REQUESTS_PER_FLUSH, Telemetry, type TelemetryContext } from './telemetry';

const CONTEXT: TelemetryContext = { app: '1.2.0', platform: 'ios', update: 'embedded', region: 'us' };

/** Runs everything that is queued behind a promise. The fakes use no timers, so this is deterministic, not a wait. */
async function drain(): Promise<void> {
  for (let i = 0; i < 100; i += 1) await Promise.resolve();
}

const row = (event: string, count = 1, params?: Record<string, string>, over: Partial<CounterRow> = {}): CounterRow =>
  ({
    event,
    ...(params ? { params } : {}),
    ...CONTEXT,
    count,
    ...over,
  }) as CounterRow;

function setup(over: { transport?: FakeTelemetryTransport | null } = {}) {
  const storage = new FakeTelemetryStorage();
  const transport = new FakeTelemetryTransport();
  let context: TelemetryContext | null = CONTEXT;
  const telemetry = new Telemetry({
    storage,
    transport: over.transport === undefined ? transport : over.transport,
    context: () => context,
  });
  return {
    storage,
    transport,
    telemetry,
    setContext: (next: TelemetryContext | null) => {
      context = next;
    },
    /** n signals that are all different rows (an app version each). */
    many: (n: number, from = 0) => {
      for (let i = from; i < from + n; i += 1) {
        context = { ...CONTEXT, app: `1.${i}.0` };
        telemetry.signal('Recording.started');
      }
      context = CONTEXT;
    },
  };
}

/** `setup()` with start() done, as the app has it by the time anything is counted. */
async function startedSetup() {
  const made = setup();
  await made.telemetry.start();
  return made;
}

/** The signal method with its types off, for what the types keep a caller from writing. */
const loose = (telemetry: Telemetry) => telemetry as unknown as { signal(event: unknown, params?: unknown): void };

const writes = (storage: FakeTelemetryStorage) => storage.calls.filter((call) => call === 'writeBacklog').length;

describe('signal and flush', () => {
  test('send the counts, one row per distinct signal, under the dimensions they happened in', async () => {
    const { telemetry, transport } = setup();
    telemetry.signal('Recording.started');
    telemetry.signal('Navigation.screen', { screen: 'map' });
    telemetry.signal('Recording.started');
    telemetry.signal('Navigation.screen', { screen: 'log' });
    await telemetry.flush();

    expect(transport.batches).toEqual([
      [
        row('Recording.started', 2),
        row('Navigation.screen', 1, { screen: 'map' }),
        row('Navigation.screen', 1, { screen: 'log' }),
      ],
    ]);
  });

  test('send nothing when nothing was counted', async () => {
    const { telemetry, transport } = setup();
    await telemetry.flush();
    expect(transport.batches).toEqual([]);
  });

  test('count a signal under the context it happened in, read when it happens', async () => {
    const { telemetry, transport, setContext } = setup();
    telemetry.signal('Debrief.generated');
    setContext({ ...CONTEXT, region: 'israel' });
    telemetry.signal('Debrief.generated');
    await telemetry.flush();
    expect(transport.batches[0]).toEqual([
      row('Debrief.generated', 1),
      row('Debrief.generated', 1, undefined, { region: 'israel' }),
    ]);
  });

  test('count nothing for a signal that does not fit the schema', async () => {
    const { telemetry, transport } = setup();
    loose(telemetry).signal('Flight.route');
    loose(telemetry).signal('Navigation.screen', { screen: 'settings' });
    loose(telemetry).signal('Navigation.screen');
    loose(telemetry).signal('Recording.started', { airport: 'LLBG' });
    loose(telemetry).signal(undefined);
    await telemetry.flush();
    expect(transport.batches).toEqual([]);
  });

  test.each([
    ['not known', null],
    ['an app version that is not three numbers', { ...CONTEXT, app: '1.2' }],
    ['a platform that is not ios or android', { ...CONTEXT, platform: 'web' }],
    ['an update id that is neither embedded nor a UUID', { ...CONTEXT, update: 'beta-3' }],
    ['a region that is not offered', { ...CONTEXT, region: 'eu' }],
    ['an extra field (an identifier cannot ride along)', { ...CONTEXT, deviceId: 'abc' }],
  ])('count nothing while the context is %s', async (_name, context) => {
    const { telemetry, transport, setContext } = setup();
    setContext(context as TelemetryContext | null);
    telemetry.signal('Recording.started');
    await telemetry.flush();
    expect(transport.batches).toEqual([]);
  });

  test('never throw: a context that throws, parameters that throw', async () => {
    const storage = new FakeTelemetryStorage();
    const transport = new FakeTelemetryTransport();
    const telemetry = new Telemetry({
      storage,
      transport,
      context: () => {
        throw new Error('settings not loaded');
      },
    });
    expect(() => telemetry.signal('Recording.started')).not.toThrow();

    const ok = setup();
    const hostile = {
      get screen(): string {
        throw new Error('getter');
      },
    };
    expect(() => loose(ok.telemetry).signal('Navigation.screen', hostile)).not.toThrow();
    await ok.telemetry.flush();
    expect(ok.transport.batches).toEqual([]);
  });

  test('keep counting after a signal that did not fit', async () => {
    const { telemetry, transport } = setup();
    loose(telemetry).signal('nope');
    telemetry.signal('FlightPlan.activated');
    await telemetry.flush();
    expect(transport.batches).toEqual([[row('FlightPlan.activated')]]);
  });
});

describe('flush in batches', () => {
  test('send 40 rows per request, the oldest first', async () => {
    const { telemetry, transport, many } = setup();
    many(85);
    await telemetry.flush();
    expect(transport.batches.map((batch) => batch.length)).toEqual([40, 40, 5]);
    expect(transport.batches.flat().map((r) => r.app)).toEqual(Array.from({ length: 85 }, (_, i) => `1.${i}.0`));
  });

  test('send a buffer that is full in one flush', async () => {
    const { telemetry, transport, many } = setup();
    many(MAX_BUFFER_KEYS);
    await telemetry.flush();
    expect(transport.batches.flat()).toHaveLength(MAX_BUFFER_KEYS);
    expect(MAX_REQUESTS_PER_FLUSH).toBe(5);
    expect(transport.batches).toHaveLength(5);
  });

  test('stop after five requests when counts keep arriving, and leave the rest for the next flush', async () => {
    const { telemetry, transport, many } = setup();
    transport.holding = true;
    many(40);
    const flushing = telemetry.flush();
    for (let request = 1; request <= 5; request += 1) {
      await drain();
      expect(transport.heldCount).toBe(1);
      many(40, request * 40);
      transport.release('sent');
    }
    await flushing;
    expect(transport.batches).toHaveLength(5);

    transport.holding = false;
    await telemetry.flush();
    expect(transport.batches.slice(5).map((batch) => batch.length)).toEqual([40]);
  });

  test('send nothing more once the buffer is empty', async () => {
    const { telemetry, transport } = setup();
    telemetry.signal('Recording.started');
    await telemetry.flush();
    await telemetry.flush();
    expect(transport.batches).toHaveLength(1);
  });
});

describe('what the server made of a batch', () => {
  test('retry: put the counts back, add them to what was counted since, and send them next time', async () => {
    const { telemetry, transport } = setup();
    transport.outcomes = ['retry'];
    telemetry.signal('Recording.started');
    telemetry.signal('Recording.started');
    await telemetry.flush();
    telemetry.signal('Recording.started');
    await telemetry.flush();

    expect(transport.batches).toEqual([[row('Recording.started', 2)], [row('Recording.started', 3)]]);
  });

  test('retry: stop, and keep every row, sent or not', async () => {
    const { telemetry, transport, many } = setup();
    transport.outcomes = ['retry'];
    many(85);
    await telemetry.flush();
    expect(transport.batches.map((batch) => batch.length)).toEqual([40]);

    await telemetry.flush();
    expect(transport.batches.slice(1).map((batch) => batch.length)).toEqual([40, 40, 5]);
  });

  test('drop: forget the batch the server refused, stop, and keep the rest', async () => {
    const { telemetry, transport, many } = setup();
    transport.outcomes = ['drop'];
    many(85);
    await telemetry.flush();
    expect(transport.batches.map((batch) => batch.length)).toEqual([40]);

    await telemetry.flush();
    const later = transport.batches.slice(1);
    expect(later.map((batch) => batch.length)).toEqual([40, 5]);
    expect(later[0]?.[0]?.app).toBe('1.40.0'); // the first 40 are gone for good
  });

  test('sent: go on with the next batch', async () => {
    const { telemetry, transport, many } = setup();
    transport.outcomes = ['sent', 'sent', 'retry'];
    many(130);
    await telemetry.flush();
    expect(transport.batches.map((batch) => batch.length)).toEqual([40, 40, 40]);
    await telemetry.flush();
    expect(transport.batches.slice(3).map((batch) => batch.length)).toEqual([40, 10]);
  });

  test('a transport that rejects counts as retry', async () => {
    const { telemetry, transport } = setup();
    transport.outcomes = [new Error('offline')];
    telemetry.signal('Recording.started');
    await expect(telemetry.flush()).resolves.toBeUndefined();
    await telemetry.flush();
    expect(transport.batches).toEqual([[row('Recording.started')], [row('Recording.started')]]);
  });

  test('a transport that throws counts as retry', async () => {
    const { telemetry, transport } = setup();
    transport.throwSynchronously = new Error('bug');
    telemetry.signal('Recording.started');
    await expect(telemetry.flush()).resolves.toBeUndefined();
    transport.throwSynchronously = null;
    await telemetry.flush();
    expect(transport.batches).toEqual([[row('Recording.started')], [row('Recording.started')]]);
  });
});

describe('flush while a send is in flight', () => {
  test('a flush asked for while another runs joins it: sends never overlap', async () => {
    const { telemetry, transport } = setup();
    transport.holding = true;
    telemetry.signal('Recording.started');
    const first = telemetry.flush();
    await drain();
    telemetry.signal('Debrief.generated');
    const second = telemetry.flush();
    await drain();
    expect(transport.batches).toEqual([[row('Recording.started')]]); // the new count is not sent beside the one in flight

    transport.release('sent');
    await drain();
    expect(transport.batches).toEqual([[row('Recording.started')], [row('Debrief.generated')]]); // the running flush takes it
    expect(transport.heldCount).toBe(1);
    transport.release('sent');
    await Promise.all([first, second]);
    expect(transport.batches).toHaveLength(2);
  });

  test('a flush can go again once the last one is over', async () => {
    const { telemetry, transport } = setup();
    telemetry.signal('Recording.started');
    await telemetry.flush();
    telemetry.signal('Recording.started');
    await telemetry.flush();
    expect(transport.batches).toHaveLength(2);
  });

  test('a signal that arrives during a send goes out with the next request of the same flush', async () => {
    const { telemetry, transport } = setup();
    transport.holding = true;
    telemetry.signal('Recording.started');
    const flushing = telemetry.flush();
    await drain();
    telemetry.signal('Debrief.generated');
    transport.release('sent');
    await drain();
    transport.release('sent');
    await flushing;
    expect(transport.batches).toEqual([[row('Recording.started')], [row('Debrief.generated')]]);
  });

  test('a signal that arrives during a send is counted with the batch that comes back for a retry', async () => {
    const { telemetry, transport } = setup();
    transport.holding = true;
    telemetry.signal('Recording.started');
    const flushing = telemetry.flush();
    await drain();
    telemetry.signal('Recording.started');
    transport.release('retry');
    await flushing;

    transport.holding = false;
    await telemetry.flush();
    expect(transport.batches[1]).toEqual([row('Recording.started', 2)]);
  });

  test('opting out during a send: a retry answer does not put the counts back', async () => {
    const { telemetry, transport, storage } = setup();
    transport.holding = true;
    telemetry.signal('Recording.started');
    const flushing = telemetry.flush();
    await drain();
    await telemetry.setEnabled(false);
    transport.release('retry');
    await flushing;
    await drain();

    expect(storage.backlog).toBeNull();
    transport.holding = false;
    await telemetry.setEnabled(true);
    await telemetry.flush();
    expect(transport.batches).toHaveLength(1);
  });

  test('opting out and back in during a send does not bring the old counts back either', async () => {
    const { telemetry, transport } = setup();
    transport.holding = true;
    telemetry.signal('Recording.started');
    const flushing = telemetry.flush();
    await drain();
    await telemetry.setEnabled(false);
    await telemetry.setEnabled(true);
    transport.release('retry');
    await flushing;

    transport.holding = false;
    telemetry.signal('Debrief.generated');
    await telemetry.flush();
    expect(transport.batches[1]).toEqual([row('Debrief.generated')]);
  });

  test('opting out during a send ends the flush: no further batch goes out', async () => {
    const { telemetry, transport, many } = setup();
    transport.holding = true;
    many(85);
    const flushing = telemetry.flush();
    await drain();
    await telemetry.setEnabled(false);
    transport.release('sent');
    await flushing;
    await drain();
    expect(transport.batches).toHaveLength(1);
    expect(transport.heldCount).toBe(0);
  });

  test('asking for what is already on does not make a send in flight stale', async () => {
    const { telemetry, transport } = setup();
    transport.holding = true;
    telemetry.signal('Recording.started');
    const flushing = telemetry.flush();
    await drain();
    await telemetry.setEnabled(true);
    transport.release('retry');
    await flushing;

    transport.holding = false;
    await telemetry.flush();
    expect(transport.batches[1]).toEqual([row('Recording.started')]);
  });
});

describe('"Share anonymous usage data"', () => {
  test('is on until the pilot says otherwise', async () => {
    const { telemetry } = setup();
    expect(telemetry.enabled).toBe(true);
    await telemetry.start();
    expect(telemetry.enabled).toBe(true);
  });

  test('off: count nothing, keep nothing, send nothing, and remember the choice', async () => {
    const { telemetry, transport, storage } = setup();
    await telemetry.setEnabled(false);
    telemetry.signal('Recording.started');
    await telemetry.flush();
    await drain();

    expect(telemetry.enabled).toBe(false);
    expect(transport.batches).toEqual([]);
    expect(storage.enabled).toBe(false);
    expect(storage.backlog).toBeNull();
    expect(writes(storage)).toBe(0);
  });

  test('off: forgets what was waiting, in memory and on the device', async () => {
    const { telemetry, transport, storage } = await startedSetup();
    telemetry.signal('Recording.started');
    await drain();
    expect(storage.backlog).not.toBeNull();

    await telemetry.setEnabled(false);
    expect(storage.backlog).toBeNull();
    await telemetry.setEnabled(true);
    await telemetry.flush();
    expect(transport.batches).toEqual([]);
  });

  test('on again: counts from zero', async () => {
    const { telemetry, transport } = setup();
    telemetry.signal('Recording.started');
    await telemetry.setEnabled(false);
    await telemetry.setEnabled(true);
    telemetry.signal('Debrief.generated');
    await telemetry.flush();
    expect(transport.batches).toEqual([[row('Debrief.generated')]]);
  });

  test('on: remembers the choice', async () => {
    const { telemetry, storage } = setup();
    storage.enabled = false;
    await telemetry.setEnabled(true);
    expect(storage.enabled).toBe(true);
    expect(telemetry.enabled).toBe(true);
  });

  test('a choice stored as off keeps everything quiet from the start, including counts made before it was read', async () => {
    const { telemetry, transport, storage } = setup();
    storage.enabled = false;
    telemetry.signal('App.launched'); // counted before start() has read the choice
    await telemetry.start();
    telemetry.signal('Recording.started');
    await telemetry.flush();
    await drain();

    expect(telemetry.enabled).toBe(false);
    expect(transport.batches).toEqual([]);
    expect(writes(storage)).toBe(0);
  });

  test('a choice stored as off leaves nothing counted before it was read to go out when the pilot turns it on later', async () => {
    const { telemetry, transport, storage } = setup();
    storage.enabled = false;
    telemetry.signal('App.launched'); // counted before start() has read the choice
    await telemetry.start();
    await telemetry.setEnabled(true);
    await telemetry.flush();
    expect(transport.batches).toEqual([]);
  });

  test('a choice stored as off removes a backlog that is still stored', async () => {
    const { telemetry, transport, storage } = setup();
    storage.enabled = false;
    storage.backlog = serializeRows([row('Recording.started', 4)]);
    await telemetry.start();
    await drain();
    expect(storage.backlog).toBeNull();
    await telemetry.flush();
    expect(transport.batches).toEqual([]);
  });

  test('a choice that cannot be read keeps this session quiet and writes nothing', async () => {
    const { telemetry, transport, storage } = setup();
    storage.failures.set('readEnabled', new Error('disk'));
    storage.backlog = serializeRows([row('Recording.started', 4)]);
    telemetry.signal('Recording.started');
    await telemetry.start();
    telemetry.signal('Debrief.generated');
    await telemetry.flush();
    await drain();

    expect(telemetry.enabled).toBe(false);
    expect(transport.batches).toEqual([]);
    expect(storage.calls).not.toContain('writeBacklog');
    expect(storage.calls).not.toContain('removeBacklog');
    expect(storage.calls).not.toContain('writeEnabled');
  });

  test('the choice made while start() is still reading beats the stored one', async () => {
    const { telemetry, transport, storage } = setup();
    storage.hold('readEnabled');
    storage.enabled = true;
    storage.backlog = serializeRows([row('Recording.started', 4)]);
    const starting = telemetry.start();
    const choosing = telemetry.setEnabled(false);
    storage.release('readEnabled');
    await Promise.all([starting, choosing]);
    await telemetry.flush();
    await drain();

    expect(telemetry.enabled).toBe(false);
    expect(storage.enabled).toBe(false);
    expect(storage.backlog).toBeNull();
    expect(transport.batches).toEqual([]);
  });

  test('turning it on while start() is still reading beats a stored off, and does not send the old backlog', async () => {
    const { telemetry, transport, storage } = setup();
    storage.hold('readEnabled');
    storage.enabled = false;
    storage.backlog = serializeRows([row('Recording.started', 4)]);
    const starting = telemetry.start();
    const choosing = telemetry.setEnabled(true);
    storage.release('readEnabled');
    await Promise.all([starting, choosing]);
    telemetry.signal('Debrief.generated');
    await telemetry.flush();

    expect(telemetry.enabled).toBe(true);
    expect(storage.enabled).toBe(true);
    expect(transport.batches).toEqual([[row('Debrief.generated')]]);
  });

  test('rejects when the choice cannot be saved, but holds for the session', async () => {
    const { telemetry, transport, storage } = setup();
    storage.failures.set('writeEnabled', new Error('disk full'));
    telemetry.signal('Recording.started');
    await expect(telemetry.setEnabled(false)).rejects.toThrow('disk full');

    expect(telemetry.enabled).toBe(false);
    expect(storage.calls).toContain('removeBacklog'); // still cleared
    await telemetry.flush();
    expect(transport.batches).toEqual([]);
  });

  test('rejects when the stored backlog cannot be removed, after the choice was saved', async () => {
    const { telemetry, storage } = setup();
    storage.failures.set('removeBacklog', new Error('locked'));
    await expect(telemetry.setEnabled(false)).rejects.toThrow('locked');
    expect(storage.enabled).toBe(false);
    expect(telemetry.enabled).toBe(false);
  });

  test('turning it on does not clear anything stored', async () => {
    const { telemetry, storage } = setup();
    await telemetry.setEnabled(true);
    expect(storage.calls).toEqual(['writeEnabled']);
  });
});

describe('with nowhere to send to', () => {
  test('keep nothing on the device and send nothing, but still remember the choice', async () => {
    const { telemetry, storage } = setup({ transport: null });
    telemetry.signal('Recording.started');
    await telemetry.flush();
    await drain();
    expect(storage.calls).toEqual(['readEnabled']);

    await telemetry.setEnabled(false);
    expect(storage.enabled).toBe(false);
    expect(telemetry.enabled).toBe(false);
  });
});

describe('the backlog on the device', () => {
  test('is kept as counts come in', async () => {
    const { telemetry, storage } = await startedSetup();
    telemetry.signal('Recording.started');
    telemetry.signal('Navigation.screen', { screen: 'map' });
    telemetry.signal('Recording.started');
    await drain();
    expect(parseRows(storage.backlog)).toEqual([
      row('Recording.started', 2),
      row('Navigation.screen', 1, { screen: 'map' }),
    ]);
  });

  test('is written once or twice for a burst of signals, and the last write is complete', async () => {
    const { telemetry, storage } = await startedSetup();
    for (let i = 0; i < 50; i += 1) telemetry.signal('Recording.started');
    await drain();
    expect(writes(storage)).toBeLessThanOrEqual(2);
    expect(parseRows(storage.backlog)).toEqual([row('Recording.started', 50)]);
  });

  test('is removed once everything was sent', async () => {
    const { telemetry, storage } = await startedSetup();
    telemetry.signal('Recording.started');
    await drain();
    await telemetry.flush();
    await drain();
    expect(storage.backlog).toBeNull();
  });

  test('stores the counts again once a send in flight did not go through', async () => {
    const { telemetry, transport, storage } = await startedSetup();
    transport.holding = true;
    telemetry.signal('Recording.started');
    await drain();
    const flushing = telemetry.flush();
    await drain();
    expect(storage.backlog).toBeNull(); // handed over, so no longer stored
    transport.release('retry');
    await flushing;
    await drain();
    expect(parseRows(storage.backlog)).toEqual([row('Recording.started')]);
  });

  test('writes nothing for a count that a full buffer refuses', async () => {
    const { telemetry, storage, many } = await startedSetup();
    many(MAX_BUFFER_KEYS);
    await drain();
    const before = writes(storage);
    many(1, MAX_BUFFER_KEYS); // a new row, over the limit
    await drain();
    expect(writes(storage)).toBe(before);
    expect(parseRows(storage.backlog)).toHaveLength(MAX_BUFFER_KEYS);
    expect(telemetry.enabled).toBe(true);
  });

  test('keeps the counts of a send that did not go through', async () => {
    const { telemetry, transport, storage } = await startedSetup();
    transport.outcomes = ['retry'];
    telemetry.signal('Recording.started');
    await telemetry.flush();
    await drain();
    expect(parseRows(storage.backlog)).toEqual([row('Recording.started')]);
  });

  test('no longer holds the counts of a send that is in flight (a send is at most once)', async () => {
    const { telemetry, transport, storage } = await startedSetup();
    transport.holding = true;
    telemetry.signal('Recording.started');
    await drain();
    const flushing = telemetry.flush();
    await drain();
    expect(storage.backlog).toBeNull();
    transport.release('sent');
    await flushing;
  });

  test('can fail to be written without losing a count or breaking a signal', async () => {
    const { telemetry, transport, storage } = await startedSetup();
    storage.failures.set('writeBacklog', new Error('disk full'));
    telemetry.signal('Recording.started');
    await drain();
    telemetry.signal('Recording.started');
    await telemetry.flush();
    expect(transport.batches).toEqual([[row('Recording.started', 2)]]);
  });

  test('goes on being written after a write failed, once the storage works again', async () => {
    const { telemetry, storage } = await startedSetup();
    storage.failures.set('writeBacklog', new Error('disk full'));
    telemetry.signal('Recording.started');
    await drain();
    expect(storage.backlog).toBeNull();

    storage.failures.delete('writeBacklog');
    telemetry.signal('Recording.started');
    await drain();
    expect(parseRows(storage.backlog)).toEqual([row('Recording.started', 2)]);
  });

  test('is read at start, and sent together with what was counted since', async () => {
    const { telemetry, transport, storage } = setup();
    storage.backlog = serializeRows([row('Recording.started', 2), row('Debrief.generated', 1)]);
    telemetry.signal('Recording.started');
    await telemetry.flush();
    expect(transport.batches).toEqual([[row('Recording.started', 3), row('Debrief.generated', 1)]]);
  });

  test.each([
    ['text that is not JSON', 'not json'],
    ['another version', JSON.stringify({ v: 2, rows: [row('Recording.started')] })],
    ['nothing', null],
  ])('ignores %s', async (_name, text) => {
    const { telemetry, transport, storage } = setup();
    storage.backlog = text;
    telemetry.signal('Debrief.generated');
    await telemetry.flush();
    expect(transport.batches).toEqual([[row('Debrief.generated')]]);
  });

  test('is checked row by row: what no longer fits the schema is dropped', async () => {
    const { telemetry, transport, storage } = setup();
    storage.backlog = JSON.stringify({
      v: 1,
      rows: [
        row('Recording.started', 2),
        row('Flight.route'),
        { ...row('Debrief.generated'), deviceId: 'abc' },
        row('FlightPlan.activated', 0),
      ],
    });
    await telemetry.flush();
    expect(transport.batches).toEqual([[row('Recording.started', 2)]]);
  });

  test('can be unreadable without breaking the start', async () => {
    const { telemetry, transport, storage } = setup();
    storage.failures.set('readBacklog', new Error('disk'));
    telemetry.signal('Recording.started');
    await telemetry.flush();
    expect(transport.batches).toEqual([[row('Recording.started')]]);
  });

  test('is not written before the stored one has been read, so it cannot overwrite it', async () => {
    const { telemetry, storage } = setup();
    storage.hold('readBacklog');
    storage.backlog = serializeRows([row('Debrief.generated', 3)]);
    telemetry.signal('Recording.started');
    const starting = telemetry.start();
    await drain();
    expect(storage.calls).not.toContain('writeBacklog');
    expect(storage.calls).not.toContain('removeBacklog');

    storage.release('readBacklog');
    await starting;
    await drain();
    expect(parseRows(storage.backlog)).toEqual([row('Recording.started', 1), row('Debrief.generated', 3)]);
  });

  test('is written in the order the changes were made, even when a write is slow', async () => {
    const { telemetry, storage } = setup();
    await telemetry.start();
    storage.hold('writeBacklog');
    telemetry.signal('Recording.started');
    await drain();
    telemetry.signal('Recording.started');
    await drain();
    storage.release('writeBacklog');
    await drain();
    expect(parseRows(storage.backlog)).toEqual([row('Recording.started', 2)]);
    expect(parseRows(storage.backlogHistory.at(-1) ?? null)).toEqual([row('Recording.started', 2)]);
  });

  test('is not rewritten after an opt-out whose removal is still waiting behind a write', async () => {
    const { telemetry, storage } = setup();
    await telemetry.start();
    storage.hold('writeBacklog');
    telemetry.signal('Recording.started');
    await drain();
    const choosing = telemetry.setEnabled(false);
    storage.release('writeBacklog');
    await choosing;
    await drain();
    expect(storage.backlog).toBeNull();
    expect(storage.backlogHistory.at(-1)).toBeNull();
  });
});

describe('start', () => {
  test('reads the storage once, however often it is called', async () => {
    const { telemetry, storage } = setup();
    await Promise.all([telemetry.start(), telemetry.start()]);
    await telemetry.start();
    expect(storage.calls.filter((call) => call === 'readEnabled')).toHaveLength(1);
    expect(storage.calls.filter((call) => call === 'readBacklog')).toHaveLength(1);
  });

  test('is done by flush when nobody called it', async () => {
    const { telemetry, transport, storage } = setup();
    storage.backlog = serializeRows([row('Recording.started', 2)]);
    await telemetry.flush();
    expect(transport.batches).toEqual([[row('Recording.started', 2)]]);
  });

  test('does not read the backlog of a pilot who opted out', async () => {
    const { telemetry, storage } = setup();
    storage.enabled = false;
    await telemetry.start();
    expect(storage.calls).not.toContain('readBacklog');
  });
});

describe('the types', () => {
  // These lines are checked by tsc: a line that compiles where @ts-expect-error says it should not fails the typecheck.
  test('keep free text and unknown events out at compile time', () => {
    const { telemetry } = setup();
    telemetry.signal('Recording.started');
    telemetry.signal('Navigation.screen', { screen: 'map' });
    telemetry.signal('Recording.stopped', { durationMinutes: '15-60' });
    telemetry.signal('ChartPack.installed', { product: 'il-diagrams', edition: '2026-08b' });
    // @ts-expect-error not an event
    telemetry.signal('Flight.route');
    // @ts-expect-error a screen that is not in the schema
    telemetry.signal('Navigation.screen', { screen: 'settings' });
    // @ts-expect-error the parameter is missing
    telemetry.signal('Navigation.screen');
    // @ts-expect-error an event without parameters takes none
    telemetry.signal('Recording.started', { airport: 'LLBG' });
    // @ts-expect-error an extra parameter
    telemetry.signal('Navigation.screen', { screen: 'map', airport: 'LLBG' });
    expect(telemetry.enabled).toBe(true);
  });

  test('fit what the debrief engine asks for', () => {
    const { telemetry } = setup();
    const sink: NonNullable<DebriefEngineDeps['telemetry']> = telemetry;
    sink.signal('Debrief.generated');
    expect(telemetry.enabled).toBe(true);
  });
});
