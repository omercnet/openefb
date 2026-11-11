import {
  availableMapStyles,
  hasAirportData,
  isLayerAvailable,
  metarStationIds,
  parseRegion,
  REGION_DATA_LAYERS,
  ISRAEL_ONLY_DATA_LAYERS,
  regionAltimeterUnit,
  regionContains,
  regionDefaultCenter,
  regionDefaultZoom,
  regionSupports,
  formattedAltimeter,
  tafStationIds,
  unavailableReason,
  weatherStation,
  weatherStations,
} from './region';

describe('Region', () => {
  it('freshStoreDefaultsToIsrael / unknownStoredValueReadsAsTheDefaultRegion', () => {
    expect(parseRegion(null)).toBe('israel');
    expect(parseRegion('mars')).toBe('israel');
    expect(parseRegion('us')).toBe('us');
  });

  it('israelWeatherStationsMatchWhatAviationWeatherServes', () => {
    expect(metarStationIds('israel')).toEqual(['LLBG', 'LLHA', 'LLER', 'LLIB']);
    expect(new Set(tafStationIds('israel'))).toEqual(new Set(['LLBG', 'LLHA', 'LLER', 'LLIB', 'LLHZ']));
    expect(weatherStation('israel', 'llhz')?.hasMetar).toBe(false);
    expect(weatherStations('us')).toHaveLength(0);
  });

  it('altimeterUnitFollowsRegion', () => {
    expect(regionAltimeterUnit('us')).toBe('inHg');
    expect(regionAltimeterUnit('israel')).toBe('hPa');
    expect(formattedAltimeter('israel', 1017)).toBe('1017 hPa');
    expect(formattedAltimeter('us', 1016.9)).toBe('30.03 inHg');
  });

  it('usKeepsEveryLayerAndIsraelHasNoUSOnlyLayer', () => {
    for (const layer of REGION_DATA_LAYERS.filter((l) => !ISRAEL_ONLY_DATA_LAYERS.has(l))) {
      expect(isLayerAvailable('us', layer)).toBe(true);
      expect(isLayerAvailable('israel', layer)).toBe(false);
    }
    expect(regionSupports('israel', 'weatherDots')).toBe(true);
    expect(regionSupports('israel', 'ownship')).toBe(true);
    expect(regionSupports('israel', 'sectional')).toBe(false);
    expect(regionSupports('israel', 'tfrs')).toBe(false);
    expect(regionSupports('israel', 'advisories')).toBe(false);
    expect(regionSupports('israel', 'lsaRoutes')).toBe(true);
    expect(regionSupports('us', 'lsaRoutes')).toBe(false);
    expect(unavailableReason('israel')).toBe('Not available in Israel yet');
    expect(availableMapStyles('israel')).toEqual(['street']);
  });

  it('israelHomeViewCoversTheCountryAndUSKeepsConus', () => {
    expect(regionDefaultCenter('us')).toEqual({ lat: 39.0, lon: -98.0 });
    expect(regionDefaultZoom('us')).toBe(5.0);
    expect(Math.abs(regionDefaultCenter('israel').lat - 32.0)).toBeLessThan(0.5);
    expect(Math.abs(regionDefaultCenter('israel').lon - 34.9)).toBeLessThan(0.5);
    expect(regionContains('israel', { lat: 32.011, lon: 34.887 })).toBe(true);
    expect(regionContains('israel', { lat: 37.46, lon: -122.11 })).toBe(false);
    expect(regionContains('us', { lat: 32.0, lon: 34.9 })).toBe(true);
  });

  it('nrstAndSearchHaveAirportDataInBothRegions', () => {
    expect(hasAirportData('us')).toBe(true);
    expect(hasAirportData('israel')).toBe(true);
  });
});
