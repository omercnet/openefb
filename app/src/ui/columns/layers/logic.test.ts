// The Layers column's pure decisions (LayersColumnView.swift, MapViewModel.toggleLayer, OfflineMapService status
// labels, OfflineMapsView.dateString). No Swift test reads them; these pin the Swift behaviour.
import { cycleDateText, offlineStatusLabel, toggleLayer } from './logic';

describe('toggleLayer', () => {
  it('adds a hidden layer and removes a visible one', () => {
    expect(toggleLayer(['tfrs'], 'airports', 'us')).toEqual(['tfrs', 'airports']);
    expect(toggleLayer(['tfrs', 'airports'], 'tfrs', 'us')).toEqual(['airports']);
  });

  it('ignores a layer the region has no source for', () => {
    const visible = ['weatherDots'] as const;
    expect(toggleLayer(visible, 'sectional', 'israel')).toBe(visible);
    expect(toggleLayer(visible, 'cvfrRoutes', 'us')).toBe(visible);
  });
});

describe('offlineStatusLabel', () => {
  it.each([
    ['ready', 'Offline: ready'],
    ['partial', 'Offline: partial'],
    ['notDownloaded', 'Offline: not downloaded'],
    ['expired', 'Offline: expired'],
  ] as const)('%s', (status, label) => expect(offlineStatusLabel(status)).toBe(label));
});

describe('cycleDateText', () => {
  it('formats d MMM yyyy in UTC', () => {
    expect(cycleDateText(Date.UTC(2026, 11, 24, 9, 1))).toBe('24 Dec 2026');
    expect(cycleDateText(Date.UTC(2027, 0, 1, 0, 0))).toBe('1 Jan 2027');
    // 23:30 UTC on 31 Dec stays 31 Dec whatever the device zone.
    expect(cycleDateText(Date.UTC(2026, 11, 31, 23, 30))).toBe('31 Dec 2026');
  });
});
