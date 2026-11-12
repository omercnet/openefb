import { CounterBuffer, MAX_BUFFER_KEYS, parseRows, serializeRows } from './counterBuffer';
import type { CounterRow } from './schema';

const base = { app: '1.2.0', platform: 'ios', update: 'embedded', region: 'us' } as const;
const started = { event: 'Recording.started', ...base } as const;
const screen = (name: string) => ({ event: 'Navigation.screen', params: { screen: name }, ...base });

describe('CounterBuffer', () => {
  describe('add', () => {
    test('counts one more each time the same signal comes in', () => {
      const buffer = new CounterBuffer();
      expect(buffer.add(started)).toBe(true);
      expect(buffer.add(started)).toBe(true);
      expect(buffer.rows()).toEqual([{ ...started, count: 2 }]);
      expect(buffer.size).toBe(1);
    });

    test('adds a given number at once', () => {
      const buffer = new CounterBuffer();
      buffer.add(started, 5);
      buffer.add(started, 3);
      expect(buffer.rows()[0]?.count).toBe(8);
    });

    test('keeps signals that differ in any dimension apart', () => {
      const buffer = new CounterBuffer();
      buffer.add(started);
      buffer.add({ ...started, region: 'israel' });
      buffer.add({ ...started, update: '0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f' });
      buffer.add({ ...started, app: '1.2.1' });
      buffer.add({ ...started, platform: 'android' });
      buffer.add({ ...started, event: 'Debrief.generated' });
      buffer.add(screen('map'));
      buffer.add(screen('log'));
      expect(buffer.size).toBe(8);
    });

    test('does not let the order of an event\u2019s parameters make two rows', () => {
      const buffer = new CounterBuffer();
      const pack = (params: Record<string, string>) => ({ event: 'ChartPack.installed', params, ...base });
      buffer.add(pack({ product: 'il-diagrams', edition: '2026' }));
      buffer.add(pack({ edition: '2026', product: 'il-diagrams' }));
      expect(buffer.size).toBe(1);
      expect(buffer.rows()[0]?.count).toBe(2);
    });

    test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('ignores an amount of %s', (by) => {
      const buffer = new CounterBuffer();
      expect(buffer.add(started, by)).toBe(false);
      expect(buffer.size).toBe(0);
    });

    test('stops a count at the largest the server takes', () => {
      const buffer = new CounterBuffer(10, 100);
      buffer.add(started, 99);
      buffer.add(started, 5);
      expect(buffer.rows()[0]?.count).toBe(100);
      buffer.add(started, 1);
      expect(buffer.rows()[0]?.count).toBe(100);
    });

    test('clamps a first amount that is already over the largest the server takes', () => {
      const buffer = new CounterBuffer(10, 100);
      buffer.add(started, 500);
      expect(buffer.rows()[0]?.count).toBe(100);
    });

    test('keeps no empty parameters on an event that has none', () => {
      const buffer = new CounterBuffer();
      buffer.add({ ...started, params: {} });
      expect('params' in (buffer.rows()[0] ?? {})).toBe(false);
    });

    test('keeps its own copy of the parameters it was given', () => {
      const buffer = new CounterBuffer();
      const params = { screen: 'map' };
      buffer.add({ event: 'Navigation.screen', params, ...base });
      params.screen = 'log';
      expect(buffer.rows()[0]?.params).toEqual({ screen: 'map' });
    });

    test('refuses a new signal once it holds its limit of distinct rows, but keeps counting the ones it has', () => {
      const buffer = new CounterBuffer(2);
      buffer.add(screen('map'));
      buffer.add(screen('log'));
      expect(buffer.add(started)).toBe(false);
      expect(buffer.add(screen('map'))).toBe(true);
      expect(buffer.size).toBe(2);
      expect(buffer.rows()[0]?.count).toBe(2);
    });

    test('takes new signals again once rows were drained', () => {
      const buffer = new CounterBuffer(1);
      buffer.add(screen('map'));
      buffer.drain(1);
      expect(buffer.add(screen('log'))).toBe(true);
    });

    test('limits itself to MAX_BUFFER_KEYS rows by default', () => {
      expect(MAX_BUFFER_KEYS).toBe(200);
      const buffer = new CounterBuffer();
      for (let i = 0; i < MAX_BUFFER_KEYS + 5; i += 1) buffer.add({ ...started, app: `1.${i}.0` });
      expect(buffer.size).toBe(MAX_BUFFER_KEYS);
    });
  });

  describe('drain', () => {
    test('hands out the oldest rows first, up to the limit, and removes them', () => {
      const buffer = new CounterBuffer();
      buffer.add(screen('map'));
      buffer.add(started);
      buffer.add(screen('log'));

      expect(buffer.drain(2).map((r) => r.event)).toEqual(['Navigation.screen', 'Recording.started']);
      expect(buffer.size).toBe(1);
      expect(buffer.drain(5).map((r) => r.params)).toEqual([{ screen: 'log' }]);
      expect(buffer.size).toBe(0);
    });

    test('takes the whole rows of a fractional limit', () => {
      const buffer = new CounterBuffer();
      buffer.add(screen('map'));
      buffer.add(started);
      buffer.add(screen('log'));
      expect(buffer.drain(2.5)).toHaveLength(2);
    });

    test.each([0, -3, Number.NaN])('gives nothing for a limit of %s', (max) => {
      const buffer = new CounterBuffer();
      buffer.add(started);
      expect(buffer.drain(max)).toEqual([]);
      expect(buffer.size).toBe(1);
    });
  });

  describe('restore', () => {
    test('puts drained rows back, adding to what has been counted since', () => {
      const buffer = new CounterBuffer();
      buffer.add(started, 2);
      const sent = buffer.drain(10);
      buffer.add(started, 3);
      buffer.restore(sent);
      expect(buffer.rows()).toEqual([{ ...started, count: 5 }]);
    });

    test('keeps rows it had no match for', () => {
      const buffer = new CounterBuffer();
      buffer.add(screen('map'));
      const sent = buffer.drain(10);
      buffer.add(started);
      buffer.restore(sent);
      expect(buffer.rows().map((r) => r.event)).toEqual(['Recording.started', 'Navigation.screen']);
    });

    test('drops rows that no longer fit under the row limit, and clamps counts', () => {
      const buffer = new CounterBuffer(1, 10);
      buffer.add(started, 8);
      buffer.restore([
        { ...started, count: 9 },
        { ...screen('map'), count: 1 },
      ]);
      expect(buffer.rows()).toEqual([{ ...started, count: 10 }]);
    });
  });

  test('clear empties it', () => {
    const buffer = new CounterBuffer();
    buffer.add(started);
    buffer.clear();
    expect(buffer.size).toBe(0);
    expect(buffer.rows()).toEqual([]);
  });

  test('rows() is a copy: changing it changes nothing in the buffer', () => {
    const buffer = new CounterBuffer();
    buffer.add(screen('map'));
    const copy = buffer.rows();
    (copy[0] as CounterRow).count = 99;
    (copy[0]?.params as Record<string, string>).screen = 'log';
    expect(buffer.rows()).toEqual([{ ...screen('map'), count: 1 }]);
  });
});

describe('serializeRows and parseRows', () => {
  const rows: CounterRow[] = [
    { ...started, count: 2 },
    { ...screen('map'), count: 1 },
  ];

  test('round-trip', () => {
    expect(parseRows(serializeRows(rows))).toEqual(rows);
  });

  test('write a versioned object', () => {
    expect(JSON.parse(serializeRows(rows))).toEqual({ v: 1, rows });
  });

  test.each([
    ['nothing stored', null],
    ['empty text', ''],
    ['text that is not JSON', 'not json'],
    ['JSON that is not an object', '[]'],
    ['another version', JSON.stringify({ v: 2, rows })],
    ['rows that are not a list', JSON.stringify({ v: 1, rows: 'x' })],
    ['no rows key', JSON.stringify({ v: 1 })],
  ])('read %s as no rows', (_name, text) => {
    expect(parseRows(text)).toEqual([]);
  });

  test('keep the good rows and drop the bad ones one by one', () => {
    const text = JSON.stringify({
      v: 1,
      rows: [rows[0], { event: 'Flight.route', ...base, count: 1 }, null, { ...rows[1], count: 0 }, rows[1]],
    });
    expect(parseRows(text)).toEqual([rows[0], rows[1]]);
  });

  test('read no more rows than the buffer holds', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ ...started, app: `1.${i}.0`, count: 1 }));
    expect(parseRows(JSON.stringify({ v: 1, rows: many }))).toHaveLength(MAX_BUFFER_KEYS);
    expect(parseRows(JSON.stringify({ v: 1, rows: many }), 3)).toHaveLength(3);
  });
});
