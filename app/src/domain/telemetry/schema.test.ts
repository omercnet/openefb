// Port of the one Swift case of efb-212Tests/ServiceTests/TelemetryTests.swift that does not depend on MetricKit
// ("Recording duration buckets"), then the signal vocabulary: what the app may count, and with which parameters.
import { REGIONS } from '../core/region';
import { APP_SCREENS } from '../core/types';
import {
  TELEMETRY_SCHEMA,
  durationBucket,
  validateRow,
  validateSignal,
  type EventName,
  type SignalParams,
} from './schema';

describe('Telemetry Tests', () => {
  // Swift: @Test("Recording duration buckets")
  test('Recording duration buckets', () => {
    expect(durationBucket(0)).toBe('0-15');
    expect(durationBucket(14 * 60)).toBe('0-15');
    expect(durationBucket(15 * 60)).toBe('15-60');
    expect(durationBucket(60 * 60)).toBe('60+');
  });
});

describe('durationBucket', () => {
  test.each([
    [-5, '0-15'], // Swift: seconds / 60 < 15, so a negative length is the first bucket
    [0, '0-15'],
    [14 * 60 + 59, '0-15'],
    [15 * 60, '15-60'],
    [59 * 60 + 59, '15-60'],
    [60 * 60, '60+'],
    [3 * 3600, '60+'],
    [Number.POSITIVE_INFINITY, '60+'],
    [Number.NaN, '60+'], // no Swift pattern matches NaN, so it falls to default
  ])('%d seconds is %s', (seconds, bucket) => {
    expect(durationBucket(seconds)).toBe(bucket);
  });

  test('only ever gives a value the schema allows for Recording.stopped', () => {
    const allowed = TELEMETRY_SCHEMA.events['Recording.stopped'].durationMinutes.values as readonly string[];
    for (const seconds of [0, 899, 900, 3599, 3600, 1e9]) expect(allowed).toContain(durationBucket(seconds));
  });
});

describe('the vocabulary', () => {
  test('is the nine events the Swift app sent, plus the launch counter', () => {
    expect(Object.keys(TELEMETRY_SCHEMA.events).sort()).toEqual(
      [
        'App.launched',
        'ChartPack.installed',
        'Debrief.generated',
        'FlightPlan.activated',
        'Israel.briefingOpened',
        'Israel.fplShared',
        'Navigation.screen',
        'Recording.started',
        'Recording.stopped',
      ].sort(),
    );
  });

  test('has no parameter that could carry free text: closed value lists, or a short lower-case pattern for chart packs', () => {
    for (const [event, params] of Object.entries(TELEMETRY_SCHEMA.events)) {
      for (const [name, spec] of Object.entries(params as Record<string, { values?: string[]; pattern?: string }>)) {
        if (spec.values) {
          expect(spec.values.length).toBeGreaterThan(0);
        } else {
          expect(`${event}.${name}`).toMatch(/^ChartPack\.installed\.(product|edition)$/);
          expect(spec.pattern).toBe('^[a-z0-9][a-z0-9._-]{0,31}$');
        }
      }
    }
  });
});

describe('the screens', () => {
  test('are exactly the screens the app has (a new screen has to be added to the schema, the Worker and the policy)', () => {
    expect([...TELEMETRY_SCHEMA.events['Navigation.screen'].screen.values]).toEqual([...APP_SCREENS]);
  });
});

describe('validateSignal', () => {
  test('accepts an event with no parameters', () => {
    expect(validateSignal('Recording.started', undefined)).toEqual({ event: 'Recording.started', params: {} });
    expect(validateSignal('Recording.started', {})).toEqual({ event: 'Recording.started', params: {} });
  });

  test('accepts the parameters of an event and keeps them in the schema order', () => {
    expect(validateSignal('Navigation.screen', { screen: 'map' })).toEqual({
      event: 'Navigation.screen',
      params: { screen: 'map' },
    });
    const valid = validateSignal('ChartPack.installed', { edition: '2026-08b', product: 'il-diagrams' });
    expect(Object.keys(valid?.params ?? {})).toEqual(['product', 'edition']);
  });

  test.each([
    ['an event it does not know', 'Flight.route', undefined],
    ['an inherited property name', 'constructor', undefined],
    ['a lower-case event name', 'recording.started', undefined],
    ['an event that is not text', 5 as unknown as string, undefined],
    ['a parameter missing', 'Navigation.screen', undefined],
    ['a parameter missing (empty object)', 'Navigation.screen', {}],
    ['a parameter the event does not have', 'Recording.started', { airport: 'LLBG' }],
    ['an extra parameter', 'Navigation.screen', { screen: 'map', airport: 'LLBG' }],
    ['a value outside the closed list', 'Navigation.screen', { screen: 'settings' }],
    ['a value that is not text', 'Navigation.screen', { screen: 1 }],
    [
      'a value that is a list holding a valid value',
      'ChartPack.installed',
      { product: ['il-diagrams'], edition: '2026' },
    ],
    ['a pack name with capitals', 'ChartPack.installed', { product: 'IL-DIAGRAMS', edition: '2026' }],
    ['a pack name with a space', 'ChartPack.installed', { product: 'il diagrams', edition: '2026' }],
    ['a pack name that is too long', 'ChartPack.installed', { product: 'a'.repeat(33), edition: '2026' }],
    ['a pack name that is an e-mail address', 'ChartPack.installed', { product: 'pilot@example.com', edition: '2026' }],
    ['parameters that are null', 'Recording.started', null],
    ['parameters that are a number', 'Recording.started', 5],
    ['parameters that are a list', 'Navigation.screen', ['map']],
  ])('rejects %s', (_name, event, params) => {
    expect(validateSignal(event, params)).toBeNull();
  });

  test('a pack name of exactly 32 characters is allowed', () => {
    expect(validateSignal('ChartPack.installed', { product: 'a'.repeat(32), edition: '2026-08b' })).not.toBeNull();
  });

  test('does not treat a parameter named __proto__ as one the event has', () => {
    expect(validateSignal('Recording.started', JSON.parse('{"__proto__":"x"}'))).toBeNull();
  });
});

describe('the signal types', () => {
  // These lines are checked by tsc: a line that compiles where @ts-expect-error says it should not makes the typecheck fail.
  test('keep free text out at compile time', () => {
    const accepted: SignalParams<'Navigation.screen'> = { screen: 'map' };
    const noParams: SignalParams<'Recording.started'> = {};
    const stopped: SignalParams<'Recording.stopped'> = { durationMinutes: '15-60' };
    // @ts-expect-error a screen that is not in the schema
    const bad: SignalParams<'Navigation.screen'> = { screen: 'settings' };
    // @ts-expect-error an event without parameters takes none
    const extra: SignalParams<'Recording.started'> = { airport: 'LLBG' };
    // @ts-expect-error not an event
    const unknown: EventName = 'Flight.route';
    expect([accepted, noParams, stopped, bad, extra, unknown]).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Rows: what is sent to the Worker and what is kept between launches (the same shape, checked the same way).
// ---------------------------------------------------------------------------------------------------------------

const UUID = '0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const row = (over: Record<string, unknown> = {}) => ({
  event: 'Recording.started',
  app: '1.2.0',
  platform: 'ios',
  update: 'embedded',
  region: 'us',
  count: 2,
  ...over,
});

describe('validateRow', () => {
  test('accepts a row and gives it back in wire order, without parameters when there are none', () => {
    const valid = validateRow(row());
    expect(valid).toEqual(row());
    expect(Object.keys(valid ?? {})).toEqual(['event', 'app', 'platform', 'update', 'region', 'count']);
  });

  test('keeps parameters right after the event, in the schema order', () => {
    const valid = validateRow(
      row({ event: 'ChartPack.installed', params: { edition: '2026-08b', product: 'il-diagrams' } }),
    );
    expect(Object.keys(valid ?? {})).toEqual(['event', 'params', 'app', 'platform', 'update', 'region', 'count']);
    expect(Object.keys(valid?.params ?? {})).toEqual(['product', 'edition']);
  });

  test('accepts an update id that is a UUID, and empty parameters on an event that has none', () => {
    expect(validateRow(row({ update: UUID, params: {} }))).toEqual(row({ update: UUID }));
  });

  test.each([
    ['an unknown event', row({ event: 'Flight.route' })],
    ['a parameter missing', row({ event: 'Navigation.screen' })],
    ['a parameter outside the schema', row({ event: 'Navigation.screen', params: { screen: 'settings' } })],
    ['an extra field', row({ device: 'iPad13,4' })],
    ['an extra field that is a time stamp', row({ at: 1700000000000 })],
    ['a missing app version', row({ app: undefined })],
    ['an app version that is not three numbers', row({ app: '1.2' })],
    ['an app version that is a list', row({ app: ['1.2.0'] })],
    ['an unknown platform', row({ platform: 'web' })],
    ['an unknown region', row({ region: 'eu' })],
    ['an update id that is neither embedded nor a UUID', row({ update: 'abc' })],
    ['an update id with capitals', row({ update: UUID.toUpperCase() })],
    ['a count of 0', row({ count: 0 })],
    ['a negative count', row({ count: -1 })],
    ['a fractional count', row({ count: 1.5 })],
    ['a count above the maximum', row({ count: 100001 })],
    ['a count that is text', row({ count: '2' })],
    ['a missing count', row({ count: undefined })],
    ['null', null],
    ['text', 'Recording.started'],
    ['a list', [row()]],
  ])('rejects %s', (_name, bad) => {
    expect(validateRow(bad)).toBeNull();
  });

  test('accepts the largest count', () => {
    expect(validateRow(row({ count: 100000 }))?.count).toBe(100000);
  });
});

describe('the other lists', () => {
  test('regions and platforms are the ones the app knows', () => {
    expect([...TELEMETRY_SCHEMA.regions]).toEqual([...REGIONS]);
    expect([...TELEMETRY_SCHEMA.platforms]).toEqual(['ios', 'android']);
  });
});
