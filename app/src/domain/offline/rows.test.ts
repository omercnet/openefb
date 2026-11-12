import { bounds } from './bounds';
import type { OfflinePackSummary } from './packModel';
import { offlinePackRow } from './rows';

const now = Date.UTC(2026, 10, 1);
const mk = (
  o: Partial<OfflinePackSummary> & { cycle?: number | null; layer?: 'street' | 'sectional' } = {},
): OfflinePackSummary => ({
  context: {
    id: 'i',
    name: 'Bay',
    layer: o.layer ?? 'street',
    bounds: bounds(1, 1, 2, 2),
    cycleEffective: o.cycle ?? null,
    createdAt: 0,
  },
  state: o.state ?? { kind: 'complete' },
  completedResources: o.completedResources ?? 10,
  expectedResources: o.expectedResources ?? 10,
  completedBytes: o.completedBytes ?? 45_000,
});

describe('offlinePackRow', () => {
  it('ready, downloading, paused, failed, expired and incomplete read distinctly with the right action', () => {
    expect(offlinePackRow(mk(), now)).toMatchObject({
      subtitle: 'Ready (45 KB)',
      action: 'none',
      title: 'Bay (Street)',
    });
    expect(offlinePackRow(mk({ state: { kind: 'downloading' }, completedResources: 5 }), now)).toMatchObject({
      subtitle: 'Downloading 50% (45 KB)',
      action: 'pause',
    });
    expect(offlinePackRow(mk({ state: { kind: 'paused' }, completedResources: 3 }), now)).toMatchObject({
      action: 'resume',
      fraction: 0.3,
    });
    expect(offlinePackRow(mk({ state: { kind: 'failed', reason: 'Removed' } }), now)).toMatchObject({
      subtitle: 'Failed: Removed',
      action: 'redownload',
    });
    expect(offlinePackRow(mk({ layer: 'sectional', cycle: Date.UTC(2026, 8, 3, 9, 1) }), now)).toMatchObject({
      action: 'redownload',
      fraction: 1,
    });
    expect(offlinePackRow(mk({ completedResources: 5 }), now)).toMatchObject({
      subtitle: 'Incomplete 50% (45 KB)',
      action: 'redownload',
    });
  });
});
