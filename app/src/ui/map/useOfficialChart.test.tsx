import { act } from 'react';
import { render } from '../../../tests/support/ui';
import { officialChartOf, useOfficialChart, type OfficialChart, type OfficialChartSource } from './useOfficialChart';

function fakePack(path: string | null) {
  const listeners = new Set<() => void>();
  let version = 0;
  const source: OfficialChartSource & { packPath: string | null } = {
    packPath: path,
    subscribe: (l) => (listeners.add(l), () => void listeners.delete(l)),
    getVersion: () => version,
  };
  return {
    source,
    set(next: string | null) {
      source.packPath = next;
      version += 1;
      listeners.forEach((l) => l());
    },
  };
}

describe('the official chart pack on the map', () => {
  it('is an mbtiles URL of the installed pack, percent-encoded (Application Support has a space)', () => {
    expect(officialChartOf({ packPath: '/data/Application Support/israel-cvfr.mbtiles' })).toEqual({
      present: true,
      url: 'mbtiles:///data/Application%20Support/israel-cvfr.mbtiles',
    });
    expect(officialChartOf({ packPath: null })).toEqual({ present: false, url: null });
    expect(officialChartOf(null).present).toBe(false);
  });

  it('follows a download, an update and a removal while the map is open, and is off outside Israel', async () => {
    const pack = fakePack(null);
    let seen!: OfficialChart;
    let outside!: OfficialChart;
    const Probe = () => {
      seen = useOfficialChart(pack.source, true);
      outside = useOfficialChart(pack.source, false);
      return null;
    };
    await render(<Probe />);
    expect(seen.present).toBe(false);
    await act(async () => pack.set('/p/a.mbtiles'));
    expect(seen).toEqual({ present: true, url: 'mbtiles:///p/a.mbtiles' });
    await act(async () => pack.set('/p/b.mbtiles'));
    expect(seen.url).toBe('mbtiles:///p/b.mbtiles');
    expect(outside.present).toBe(false);
    await act(async () => pack.set(null));
    expect(seen.present).toBe(false);
  });
});
