import { act, useEffect } from 'react';
import { render } from '../../../tests/support/ui';
import type { FeatureCollection } from '../../domain/map/geojson';
import { ISRAEL_CLOSURE_REFRESH_MS, useIsraelChart, type IsraelChartInputs } from './useIsraelChart';

const db = {
  reportingPoints: jest.fn(async () => []),
  routeSegments: jest.fn(async () => []),
  airspacesOfKind: jest.fn(async () => []),
  runwaysIn: jest.fn(async () => []),
  aerodromesIn: jest.fn(async () => []),
};

let seen: Readonly<Record<string, FeatureCollection>> | undefined;
let lookup: ((code: string) => unknown) | undefined;
function Probe(props: IsraelChartInputs) {
  const chart = useIsraelChart(props);
  useEffect(() => {
    seen = chart.sources;
    lookup = chart.pointLookup;
  });
  return null;
}

beforeEach(() => {
  jest.useFakeTimers();
  seen = undefined;
  Object.values(db).forEach((m) => m.mockClear());
});
afterEach(() => jest.useRealTimers());

const flush = () => act(async () => void (await Promise.resolve()));

describe('useIsraelChart', () => {
  it('does nothing outside Israel', async () => {
    await render(<Probe db={db} notam={null} enabled={false} />);
    await flush();
    expect(db.reportingPoints).not.toHaveBeenCalled();
    expect(seen).toBeUndefined();
  });

  it('loads the chart once and reports no feed without a NOTAM service', async () => {
    const statuses: unknown[] = [];
    await render(<Probe db={db} notam={null} enabled onClosureStatus={(s) => statuses.push(s)} />);
    await flush();
    await flush();
    expect(Object.keys(seen ?? {})).toEqual(expect.arrayContaining(['il-routes', 'il-aerodromes', 'il-closures']));
    expect(statuses).toEqual([{ kind: 'noFeed' }, { kind: 'noFeed' }]); // the base chart, then the (empty) feed
    expect(db.reportingPoints).toHaveBeenCalledTimes(1);
  });

  it('refreshes the closures every five minutes without reloading the chart', async () => {
    const fetchFeed = jest.fn(async () => {
      throw new Error('offline');
    });
    await render(<Probe db={db} notam={{ fetchFeed }} enabled />);
    await flush();
    await flush();
    expect(fetchFeed).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(ISRAEL_CLOSURE_REFRESH_MS);
    });
    await flush();
    expect(fetchFeed).toHaveBeenCalledTimes(2);
    expect(db.reportingPoints).toHaveBeenCalledTimes(1);
  });

  it('looks a code up among the reporting points, then the aerodromes (the briefing highlight)', async () => {
    db.reportingPoints.mockResolvedValueOnce([{ code: 'GALIM', latitude: 32.1, longitude: 34.8 }] as never);
    db.aerodromesIn.mockResolvedValueOnce([
      { code: 'LLHZ', latitude: 32.18, longitude: 34.83, use: 'civil' },
      { code: 'GALIM', latitude: 1, longitude: 1, use: 'civil' },
    ] as never);
    await render(<Probe db={db} notam={null} enabled />);
    await flush();
    await flush();
    expect(lookup?.('galim')).toEqual({ lat: 32.1, lon: 34.8 });
    expect(lookup?.('LLHZ')).toEqual({ lat: 32.18, lon: 34.83 });
    expect(lookup?.('NOPE')).toBeNull();
  });

  it('draws the chart before a slow relay answers, and a scheduled refresh bypasses the cached feed', async () => {
    const gate = Promise.withResolvers<never>();
    const fetchFeed = jest.fn((_force?: boolean) => gate.promise);
    await render(<Probe db={db} notam={{ fetchFeed }} enabled />);
    await flush();
    await flush();
    expect(Object.keys(seen ?? {})).toContain('il-routes'); // the relay is still pending
    expect(fetchFeed).toHaveBeenCalledWith(false);
    gate.reject(new Error('timeout'));
    await flush();
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(ISRAEL_CLOSURE_REFRESH_MS);
    });
    await flush();
    expect(fetchFeed).toHaveBeenLastCalledWith(true);
  });

  it('drawing the base chart resets the closure status, so a remount does not keep the old one', async () => {
    const statuses: unknown[] = [];
    const gate = Promise.withResolvers<never>();
    await render(
      <Probe db={db} notam={{ fetchFeed: () => gate.promise }} enabled onClosureStatus={(s) => statuses.push(s)} />,
    );
    await flush();
    await flush();
    expect(statuses[0]).toEqual({ kind: 'noFeed' }); // before the relay answers
    gate.reject(new Error('timeout'));
  });
});
