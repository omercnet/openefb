import { initialVisibleLayers } from './initialLayers';

describe('initialVisibleLayers', () => {
  it('the US opens on the sectional, airports, ownship and TFRs', () => {
    expect([...initialVisibleLayers('us')].sort()).toEqual(['airports', 'ownship', 'sectional', 'tfrs']);
  });

  it('Israel drops what has no source there and turns on its METAR dots and the CVFR chart', () => {
    const layers = initialVisibleLayers('israel');
    expect(layers.has('weatherDots')).toBe(true);
    expect(layers.has('ownship')).toBe(true);
    expect(layers.has('cvfrRoutes')).toBe(true);
    expect(layers.has('tfrs')).toBe(false);
    expect(layers.has('sectional')).toBe(false);
  });
});
