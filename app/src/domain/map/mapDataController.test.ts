// Ports efb-212Tests/IntegrationTests/MapLoadingFlowTests.swift (13 cases, same names) against MapDataController, plus
// JS-only race and error-path cases. The Swift harness used a synchronous database; the TS database is async, so each
// toggle is awaited. `RecordingDatabase` mirrors the Swift RecordingDatabaseService.
import { makeAirport, type Airport, type Airspace, type Coordinate, type MapLayer, type Navaid } from '../core';
import { MapDataController, type MapAppState, type MapDataSource } from './mapDataController';
import { LOW_ZOOM_THRESHOLD, MAX_LOW_ZOOM_RADIUS_NM, MAX_RADIUS_NM } from './mapQueryRegion';

const airport = (icao: string, lat: number, lon: number): Airport =>
  makeAirport({ icao, name: icao, latitude: lat, longitude: lon, elevation: 0, type: 'airport', ownership: 'public' });
const kpao = airport('KPAO', 37.4611, -122.115);
const ksql = airport('KSQL', 37.5119, -122.2494);
const kpaoCoord: Coordinate = { lat: 37.4611, lon: -122.115 };

class RecordingDatabase implements MapDataSource {
  airportList: Airport[] = [];
  toweredList: Airport[] = [];
  navaidList: Navaid[] = [];
  airspaceList: Airspace[] = [];
  failAirportQueries = false;
  airportQueries: { center: Coordinate; radiusNM: number }[] = [];
  toweredQueries: { center: Coordinate; radiusNM: number }[] = [];
  navaidQueryCount = 0;
  airspaceQueryCount = 0;
  airportsNear = async (center: Coordinate, radiusNM: number) => {
    this.airportQueries.push({ center, radiusNM });
    if (this.failAirportQueries) throw new Error('db');
    return this.airportList;
  };
  toweredAirportsNear = async (center: Coordinate, radiusNM: number) => {
    this.toweredQueries.push({ center, radiusNM });
    return this.toweredList;
  };
  navaidsNear = async () => {
    this.navaidQueryCount += 1;
    return this.navaidList;
  };
  airspacesNear = async () => {
    this.airspaceQueryCount += 1;
    return this.airspaceList;
  };
}

function makeHarness(opts: { airports?: Airport[]; zoom?: number } = {}) {
  const db = new RecordingDatabase();
  db.airportList = opts.airports ?? [kpao, ksql];
  const appState: MapAppState = {
    region: 'us',
    visibleLayers: new Set<MapLayer>(['sectional', 'airports', 'ownship', 'tfrs']),
    mapCenter: { lat: 39, lon: -98 },
    mapZoom: opts.zoom ?? 11,
    mapVisibleBounds: null,
  };
  const selected: string[] = [];
  const vm = new MapDataController({
    appState,
    db,
    regionChangeDebounceMs: 0,
    onAirportSelected: (i) => selected.push(i),
  });
  return { vm, appState, db, selected, snap: () => vm.getSnapshot() };
}
type Harness = ReturnType<typeof makeHarness>;

const loadViaLayerToggle = async (h: Harness) => {
  await h.vm.toggleLayer('airports'); // off
  await h.vm.toggleLayer('airports'); // on -> load
};
const bounds = (c: Coordinate) => ({
  ne: { lat: c.lat + 0.1, lon: c.lon + 0.1 },
  sw: { lat: c.lat - 0.1, lon: c.lon - 0.1 },
});
const changeRegion = (h: Harness, to: Coordinate, zoom = 11) => {
  const b = bounds(to);
  h.vm.onRegionChanged(to, zoom, b.ne, b.sw);
};
const changeToConusRegion = (h: Harness, zoom = 4) =>
  h.vm.onRegionChanged({ lat: 39, lon: -98 }, zoom, { lat: 50, lon: -66 }, { lat: 25, lon: -125 });

describe('Map Loading Flow Integration Tests', () => {
  describe('initial / layer-driven load', () => {
    it('enablingAirportsLayerLoadsAirportsForCurrentRegionAtMaxRadius', async () => {
      const h = makeHarness();
      h.appState.mapCenter = kpaoCoord;
      await loadViaLayerToggle(h);
      expect(h.snap().visibleAirports.map((a) => a.icao)).toEqual(['KPAO', 'KSQL']);
      expect(h.snap().isLoadingAirports).toBe(false);
      expect(h.snap().lastError).toBeNull();
      const query = h.db.airportQueries.at(-1);
      expect(query?.center.lat).toBe(kpaoCoord.lat);
      expect(query?.radiusNM).toBe(MAX_RADIUS_NM);
    });

    it('emptyRegionIsNotAnError', async () => {
      const h = makeHarness({ airports: [] });
      await loadViaLayerToggle(h);
      expect(h.snap().visibleAirports).toEqual([]);
      expect(h.snap().lastError).toBeNull();
    });

    it('disablingALayerDoesNotQueryTheDatabase', async () => {
      const h = makeHarness();
      await h.vm.toggleLayer('airports');
      expect(h.appState.visibleLayers.has('airports')).toBe(false);
      expect(h.db.airportQueries).toEqual([]);
    });
  });

  describe('layer-gated queries', () => {
    it('navaidsAndAirspacesAreOnlyQueriedWhileTheirLayersAreVisible', async () => {
      const h = makeHarness();
      await loadViaLayerToggle(h);
      expect(h.db.navaidQueryCount).toBe(0);
      expect(h.db.airspaceQueryCount).toBe(0);
      expect(h.snap().visibleNavaids).toEqual([]);
      h.db.navaidList = [
        { id: 'SJC', name: 'San Jose', type: 'vor_dme', latitude: 37.36, longitude: -121.93, frequency: 114.1 },
      ];
      await h.vm.toggleLayer('navaids');
      await h.vm.toggleLayer('airspace');
      expect(h.db.navaidQueryCount).toBe(1);
      expect(h.snap().visibleNavaids.map((n) => n.id)).toEqual(['SJC']);
      expect(h.db.airspaceQueryCount).toBe(1);
    });
  });

  describe('failure', () => {
    it('airportQueryFailureSetsErrorAndClearsLoadingFlag', async () => {
      const h = makeHarness();
      h.db.failAirportQueries = true;
      await loadViaLayerToggle(h);
      expect(h.snap().lastError).toEqual({ kind: 'databaseCorrupted' });
      expect(h.snap().isLoadingAirports).toBe(false);
      expect(h.snap().visibleAirports).toEqual([]);
    });
  });

  describe('debounced region changes', () => {
    it('regionChangeIsDebouncedAndOnlyTheLastOneQueries', async () => {
      const h = makeHarness();
      const last = { lat: 38, lon: -122 };
      changeRegion(h, { lat: 37, lon: -122 });
      changeRegion(h, { lat: 37.5, lon: -122 });
      changeRegion(h, last);
      expect(h.db.airportQueries).toEqual([]);
      await h.vm.settleRegionChange();
      expect(h.db.airportQueries).toHaveLength(1);
      expect(h.db.airportQueries[0]?.center.lat).toBe(last.lat);
      expect(h.appState.mapCenter.lat).toBe(last.lat);
      expect(h.appState.mapZoom).toBe(11);
    });

    it('smallPanAtSameZoomUpdatesAppStateButDoesNotRequery', async () => {
      const h = makeHarness();
      changeRegion(h, kpaoCoord);
      await h.vm.settleRegionChange();
      expect(h.db.airportQueries).toHaveLength(1);
      const nudged = { lat: kpaoCoord.lat + 1 / 60, lon: kpaoCoord.lon };
      changeRegion(h, nudged);
      await h.vm.settleRegionChange();
      expect(h.db.airportQueries).toHaveLength(1);
      expect(h.appState.mapCenter.lat).toBe(nudged.lat);
    });

    it('panningFarEnoughRequeriesAtTheNewCenter', async () => {
      const h = makeHarness();
      changeRegion(h, kpaoCoord);
      await h.vm.settleRegionChange();
      const farther = { lat: kpaoCoord.lat + 0.5, lon: kpaoCoord.lon };
      changeRegion(h, farther);
      await h.vm.settleRegionChange();
      expect(h.db.airportQueries).toHaveLength(2);
      expect(h.db.airportQueries.at(-1)?.center.lat).toBe(farther.lat);
    });
  });

  describe('low zoom: towered airports over the whole visible region', () => {
    it('lowZoomQueriesToweredAirportsOverTheWholeRegionNotACappedDisc', async () => {
      const h = makeHarness({ zoom: 4 });
      h.db.toweredList = [kpao];
      changeToConusRegion(h);
      await h.vm.settleRegionChange();
      expect(h.db.airportQueries).toEqual([]);
      const radius = h.db.toweredQueries.at(-1)?.radiusNM ?? 0;
      expect(radius).toBeGreaterThan(MAX_RADIUS_NM);
      expect(radius).toBeLessThanOrEqual(MAX_LOW_ZOOM_RADIUS_NM);
      expect(h.snap().visibleAirports.map((a) => a.icao)).toEqual(['KPAO']);
    });

    it('zoomingInAcrossTheThresholdSwitchesToTheFullAirportQuery', async () => {
      const h = makeHarness({ zoom: 4 });
      h.db.toweredList = [kpao];
      changeRegion(h, kpaoCoord, LOW_ZOOM_THRESHOLD - 0.5);
      await h.vm.settleRegionChange();
      expect(h.db.toweredQueries).toHaveLength(1);
      expect(h.db.airportQueries).toEqual([]);
      changeRegion(h, kpaoCoord, LOW_ZOOM_THRESHOLD);
      await h.vm.settleRegionChange();
      expect(h.db.airportQueries).toHaveLength(1);
      expect(h.snap().visibleAirports.map((a) => a.icao)).toEqual(['KPAO', 'KSQL']);
    });

    it('zoomingOutAcrossTheThresholdSwitchesToTowered', async () => {
      const h = makeHarness({ zoom: 11 });
      h.db.toweredList = [kpao];
      changeRegion(h, kpaoCoord, LOW_ZOOM_THRESHOLD);
      await h.vm.settleRegionChange();
      expect(h.db.airportQueries).toHaveLength(1);
      changeRegion(h, kpaoCoord, LOW_ZOOM_THRESHOLD - 0.5);
      await h.vm.settleRegionChange();
      expect(h.db.toweredQueries).toHaveLength(1);
      expect(h.snap().visibleAirports.map((a) => a.icao)).toEqual(['KPAO']);
    });

    it('layerToggleAtLowZoomUsesTheTowerQuery', async () => {
      const h = makeHarness({ zoom: 4 });
      h.db.toweredList = [kpao];
      await loadViaLayerToggle(h);
      expect(h.db.airportQueries).toEqual([]);
      expect(h.snap().visibleAirports.map((a) => a.icao)).toEqual(['KPAO']);
    });
  });

  describe('airport tap', () => {
    it('tappingAirportOpensItsInfoSheet', () => {
      const h = makeHarness();
      h.vm.onAirportTapped('KSQL');
      expect(h.selected).toEqual(['KSQL']);
    });
  });
});

describe('MapDataController (JS-only guards)', () => {
  it('a slow older airport load never overwrites a newer one', async () => {
    const h = makeHarness();
    let release!: (a: Airport[]) => void;
    const slow = new Promise<Airport[]>((r) => (release = r));
    h.db.airportsNear = async () => slow;
    const first = h.vm.toggleLayer('airports'); // off
    await first;
    const loadOld = h.vm.toggleLayer('airports'); // on: stuck on the slow query
    h.db.airportsNear = async () => [ksql];
    h.appState.visibleLayers.delete('airports');
    await h.vm.toggleLayer('airports'); // newer load resolves first
    release([kpao]);
    await loadOld;
    expect(h.snap().visibleAirports.map((a) => a.icao)).toEqual(['KSQL']);
    expect(h.snap().isLoadingAirports).toBe(false);
  });

  it('one failing layer does not abort the batch', async () => {
    const h = makeHarness();
    h.appState.visibleLayers.add('navaids').add('airspace');
    h.db.navaidsNear = async () => {
      throw new Error('boom');
    };
    await h.vm.onMapStyleLoaded();
    expect(h.db.airspaceQueryCount).toBe(1);
    expect(h.snap().visibleAirports).toHaveLength(2);
    expect(h.snap().lastError).toBeNull();
  });

  it('a synchronously throwing collaborator is handled like a rejection', async () => {
    const h = makeHarness();
    h.db.airportsNear = (() => {
      throw new Error('sync');
    }) as unknown as MapDataSource['airportsNear'];
    await h.vm.toggleLayer('airports');
    await h.vm.toggleLayer('airports');
    expect(h.snap().lastError).toEqual({ kind: 'databaseCorrupted' });
  });

  it('toggling a layer the region does not support is a no-op', async () => {
    const h = makeHarness();
    h.appState.region = 'israel';
    await h.vm.toggleLayer('navaids');
    expect(h.appState.visibleLayers.has('navaids')).toBe(false);
    expect(h.db.navaidQueryCount).toBe(0);
  });

  it('dispose cancels a pending region change and settles', async () => {
    const h = makeHarness();
    changeRegion(h, kpaoCoord);
    h.vm.dispose();
    await h.vm.settleRegionChange();
    expect(h.db.airportQueries).toEqual([]);
  });

  it('settleRegionChange waits for a change that arrives while a query is running', async () => {
    const h = makeHarness();
    changeRegion(h, kpaoCoord);
    await new Promise((r) => setTimeout(r, 1)); // run 1 starts
    changeRegion(h, { lat: 38, lon: -122 });
    await h.vm.settleRegionChange();
    expect(h.db.airportQueries.at(-1)?.center.lat).toBe(38);
  });

  it('snapshot is stable until something changes', async () => {
    const h = makeHarness();
    const a = h.snap();
    expect(h.snap()).toBe(a);
    await h.vm.toggleLayer('navaids');
    expect(h.snap()).not.toBe(a);
  });

  it('tile failures flip tilesFailing after 6 errors and clear on a network load', () => {
    const h = makeHarness();
    for (let i = 0; i < 5; i++) h.vm.noteTileError();
    expect(h.snap().tilesFailing).toBe(false);
    h.vm.noteTileError();
    expect(h.snap().tilesFailing).toBe(true);
    h.vm.noteTileLoadedFromNetwork();
    expect(h.snap().tilesFailing).toBe(false);
  });
});

describe('MapDataController.regionDidChange', () => {
  it('clears data of layers the new region lacks, forgets the last query and reloads the home view', async () => {
    const h = makeHarness();
    h.appState.visibleLayers.add('navaids');
    h.db.navaidList = [{ id: 'SJC', name: 'x', type: 'vor', latitude: 1, longitude: 1, frequency: 1 }];
    await h.vm.onMapStyleLoaded();
    expect(h.snap().visibleNavaids).toHaveLength(1);
    h.appState.region = 'israel';
    h.appState.visibleLayers.delete('navaids');
    await h.vm.regionDidChange();
    expect(h.snap().visibleNavaids).toEqual([]);
    expect(h.snap().sources.navaids.features).toEqual([]);
    expect(h.snap().sources.airports.features).toEqual([]); // Israel has no US airport source
  });
});

describe('MapDataController overlays', () => {
  const ring = [
    [37, -122],
    [37, -121],
    [38, -121],
  ];
  const make = (over: { now: number; fetchedAt: number }) => {
    const h = makeHarness();
    const tfr = { id: 't', notamID: 'n', type: 'HAZARDS' as const, title: 't', boundaries: ring };
    const vm = new MapDataController({
      appState: h.appState,
      db: h.db,
      now: () => over.now,
      tfr: { currentTFRs: async () => ({ tfrs: [tfr], fetchedAt: over.fetchedAt }) },
      advisories: {
        currentAdvisories: async () => ({
          advisories: [
            {
              id: 'a',
              kind: 'airmet',
              hazardCode: 'IFR',
              colorHex: '#fff',
              validFrom: 0,
              validTo: 10,
              boundaries: ring,
            },
            {
              id: 'b',
              kind: 'airmet',
              hazardCode: 'IFR',
              colorHex: '#fff',
              validFrom: 0,
              validTo: 1e12,
              boundaries: ring,
            },
          ],
          fetchedAt: over.fetchedAt,
        }),
      },
      weather: {
        fetchWeatherForStations: async (ids) =>
          ids
            .filter((i) => i === 'LLBG')
            .map((i) => ({ id: i, stationID: i, flightCategory: 'ifr' as const, fetchedAt: 0, observationTime: 5 })),
      },
    });
    return { vm, h };
  };

  it('a fresh TFR snapshot is drawn current, a failed load is flagged, advisories draw only valid ones', async () => {
    const { vm } = make({ now: 1_000_000, fetchedAt: 1_000_000 });
    await vm.loadTFRs();
    await vm.loadAdvisories();
    const s = vm.getSnapshot();
    expect(s.tfrOverlay).toBe('current');
    expect(s.sources.tfrs.features).toHaveLength(1);
    expect(s.sources.advisories.features.map((f) => f.properties.id)).toEqual(['b']);
  });

  it('an expired snapshot draws nothing and refreshOverlayStaleness redraws when age class changes', async () => {
    const { vm } = make({ now: 1_000_000, fetchedAt: 1_000_000 });
    await vm.loadTFRs();
    expect(vm.getSnapshot().sources.tfrs.features).toHaveLength(1);
    vm.refreshOverlayStaleness(1_000_000 + 7 * 24 * 3600 * 1000);
    expect(vm.getSnapshot().tfrOverlay).toBe('hidden');
    expect(vm.getSnapshot().sources.tfrs.features).toHaveLength(0);
  });

  it('a rejecting TFR source sets tfrLoadFailed without touching other state', async () => {
    const h = makeHarness();
    const vm = new MapDataController({
      appState: h.appState,
      db: h.db,
      tfr: {
        currentTFRs: async () => {
          throw new Error('x');
        },
      },
    });
    await vm.loadTFRs();
    expect(vm.getSnapshot().tfrLoadFailed).toBe(true);
    expect(vm.getSnapshot().sources.tfrs.features).toHaveLength(0);
  });

  it('weather dots include visible airports plus the region METAR stations and track the oldest observation', async () => {
    const { vm, h } = make({ now: 5, fetchedAt: 5 });
    h.appState.region = 'israel';
    expect(await vm.loadWeatherDots()).toBe(true);
    const s = vm.getSnapshot();
    expect(s.sources.weather.features.map((f) => f.properties.stationID)).toEqual(['LLBG']);
    expect(s.oldestWeatherObservationTime).toBe(5);
    expect(s.weatherFetchedAt).toBe(5);
  });

  it('the region load fetches weather for the airports it just loaded, not for an empty list', async () => {
    const h = makeHarness();
    h.appState.visibleLayers.add('weatherDots');
    const asked: string[][] = [];
    const vm = new MapDataController({
      appState: h.appState,
      db: h.db,
      weather: { fetchWeatherForStations: async (ids) => (asked.push(ids), []) },
    });
    await vm.onMapStyleLoaded();
    expect(asked).toEqual([['KPAO', 'KSQL']]);
  });

  it('loadWeatherDots without a source or any station returns false', async () => {
    const h = makeHarness();
    expect(await h.vm.loadWeatherDots()).toBe(false);
  });
});
