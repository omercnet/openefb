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
function Probe(props: IsraelChartInputs) {
  const sources = useIsraelChart(props);
  useEffect(() => {
    seen = sources;
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
    expect(statuses).toEqual([{ kind: 'noFeed' }]);
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
});
