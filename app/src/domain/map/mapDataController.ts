// Port of the data side of efb-212/ViewModels/MapViewModel.swift: layer-gated, bounds-sized, debounced loading of
// airports, navaids, airspaces, weather dots, TFRs and advisories into GeoJSON source data. Follow, camera and
// ownship live in camera.ts; drawing lives in src/ui/map. Platform-free: collaborators are injected interfaces.
import {
  evaluateOverlayStaleness,
  isTileFailing,
  newTileFailureTracker,
  recordTileError,
  recordTileNetworkLoad,
  regionDefaultCenter,
  isLayerAvailable,
  regionSupports,
  weatherStations,
  type Airport,
  type Airspace,
  type Coordinate,
  type MapLayer,
  type Navaid,
  type OverlayStaleness,
  type Region,
  type Tfr,
  type TileFailureTracker,
  type WeatherCache,
} from '../core';
import type { AppError } from '../errors';
import {
  advisoryFeatures,
  advisoryIsValid,
  airportFeatures,
  airspaceFeatures,
  navaidFeatures,
  tfrFeatures,
  weatherDotFeatures,
  type MapAdvisory,
} from './features';
import { EMPTY_COLLECTION, type FeatureCollection } from './geojson';
import {
  isLowZoom,
  lowZoomRadiusNM,
  MAX_LOW_ZOOM_RADIUS_NM,
  MAX_RADIUS_NM,
  radiusNM as cappedRadiusNM,
  shouldRequery,
  thin,
  thinSpatially,
  type GeoBounds,
} from './mapQueryRegion';

/** The subset of the aviation database the map reads (structurally satisfied by `AviationDatabase`). */
export interface MapDataSource {
  airportsNear(center: Coordinate, radiusNM: number): Promise<Airport[]>;
  toweredAirportsNear(center: Coordinate, radiusNM: number): Promise<Airport[]>;
  airspacesNear(center: Coordinate, radiusNM: number): Promise<Airspace[]>;
  navaidsNear(center: Coordinate, radiusNM: number): Promise<Navaid[]>;
}

export interface WeatherSource {
  fetchWeatherForStations(stationIds: string[]): Promise<WeatherCache[]>;
}
export interface TfrSource {
  currentTFRs(): Promise<{ tfrs: Tfr[]; fetchedAt: number }>;
}
export interface AdvisorySource {
  currentAdvisories(): Promise<{ advisories: MapAdvisory[]; fetchedAt: number }>;
}

/** The slice of AppState the map reads and writes. Mutable on purpose: I1 backs it with the app store. */
export interface MapAppState {
  region: Region;
  visibleLayers: Set<MapLayer>;
  mapCenter: Coordinate;
  mapZoom: number;
  mapVisibleBounds: GeoBounds | null;
}

export interface MapSources {
  airports: FeatureCollection;
  navaids: FeatureCollection;
  airspaces: FeatureCollection;
  weather: FeatureCollection;
  tfrs: FeatureCollection;
  advisories: FeatureCollection;
}

export interface MapDataSnapshot {
  version: number;
  visibleAirports: readonly Airport[];
  visibleNavaids: readonly Navaid[];
  visibleAirspaces: readonly Airspace[];
  isLoadingAirports: boolean;
  lastError: AppError | null;
  sources: MapSources;
  tfrOverlay: OverlayStaleness;
  advisoryOverlay: OverlayStaleness;
  tfrFetchedAt: number | null;
  tfrLoadFailed: boolean;
  advisoriesFetchedAt: number | null;
  advisoriesLoadFailed: boolean;
  weatherFetchedAt: number | null;
  oldestWeatherObservationTime: number | null;
  tilesFailing: boolean;
  /** Mirrors `appState.mapCenter`/`mapZoom`/layers so a snapshot subscriber re-reads on any change. */
  region: Region;
  visibleLayers: ReadonlySet<MapLayer>;
}

export interface MapDataDeps {
  appState: MapAppState;
  db: MapDataSource;
  weather?: WeatherSource;
  tfr?: TfrSource;
  advisories?: AdvisorySource;
  /** Production 500 ms. Zero in tests: back-to-back region changes still coalesce. */
  regionChangeDebounceMs?: number;
  now?: () => number;
  /** Called when the user taps an airport dot (the app opens its info sheet). */
  onAirportSelected?: (icao: string) => void;
}

const MAX_AIRSPACE_RADIUS_NM = 300;

export class MapDataController {
  private readonly appState: MapAppState;
  private readonly deps: MapDataDeps;
  private readonly debounceMs: number;
  private readonly now: () => number;
  private readonly listeners = new Set<() => void>();

  private visibleAirports: Airport[] = [];
  private visibleNavaids: Navaid[] = [];
  private visibleAirspaces: Airspace[] = [];
  private lastError: AppError | null = null;
  private sources: MapSources = {
    airports: EMPTY_COLLECTION,
    navaids: EMPTY_COLLECTION,
    airspaces: EMPTY_COLLECTION,
    weather: EMPTY_COLLECTION,
    tfrs: EMPTY_COLLECTION,
    advisories: EMPTY_COLLECTION,
  };
  private loadedTfrs: Tfr[] = [];
  private loadedAdvisories: MapAdvisory[] = [];
  private tfrOverlay: OverlayStaleness = 'current';
  private advisoryOverlay: OverlayStaleness = 'current';
  private tfrFetchedAt: number | null = null;
  private tfrLoadFailed = false;
  private advisoriesFetchedAt: number | null = null;
  private advisoriesLoadFailed = false;
  private weatherFetchedAt: number | null = null;
  private oldestWeather: number | null = null;
  private tileTracker: TileFailureTracker = newTileFailureTracker();
  private tilesFailing = false;

  private lastQueryCenter: Coordinate | null = null;
  private lastQueryRadiusNM: number | null = null;
  private lastQueryWasLowZoom: boolean | null = null;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRegion: { promise: Promise<void>; resolve: () => void } | null = null;
  private airportsInFlight = 0;
  private regionRunsInFlight = 0;
  /** Latest-wins tokens: a slower, older load must never overwrite a newer one. */
  private seq = { airports: 0, navaids: 0, airspaces: 0, weather: 0, tfrs: 0, advisories: 0 };
  private disposed = false;
  private version = 0;
  private cached: MapDataSnapshot | null = null;

  constructor(deps: MapDataDeps) {
    this.deps = deps;
    this.appState = deps.appState;
    this.debounceMs = deps.regionChangeDebounceMs ?? 500;
    this.now = deps.now ?? Date.now;
  }

  // MARK: subscription (useSyncExternalStore shape)

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): MapDataSnapshot => {
    if (this.cached && this.cached.version === this.version) return this.cached;
    this.cached = {
      version: this.version,
      visibleAirports: this.visibleAirports,
      visibleNavaids: this.visibleNavaids,
      visibleAirspaces: this.visibleAirspaces,
      isLoadingAirports: this.airportsInFlight > 0,
      lastError: this.lastError,
      sources: this.sources,
      tfrOverlay: this.tfrOverlay,
      advisoryOverlay: this.advisoryOverlay,
      tfrFetchedAt: this.tfrFetchedAt,
      tfrLoadFailed: this.tfrLoadFailed,
      advisoriesFetchedAt: this.advisoriesFetchedAt,
      advisoriesLoadFailed: this.advisoriesLoadFailed,
      weatherFetchedAt: this.weatherFetchedAt,
      oldestWeatherObservationTime: this.oldestWeather,
      tilesFailing: this.tilesFailing,
      region: this.appState.region,
      visibleLayers: new Set(this.appState.visibleLayers),
    };
    return this.cached;
  };

  /** Re-arms a disposed controller (React strict mode runs effect cleanup and setup on the same instance). */
  activate(): void {
    this.disposed = false;
  }

  /** Cancels the debounce and ignores any load still in flight. Safe to call twice. */
  dispose(): void {
    this.disposed = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.resolvePending();
    this.listeners.clear();
  }

  private emit(): void {
    if (this.disposed) return;
    this.version += 1;
    for (const l of [...this.listeners]) l();
  }

  // MARK: style loaded / region

  /** Loads the home view of the current region. Call when the map style finishes loading. */
  onMapStyleLoaded(): Promise<void> {
    const { region, mapZoom, mapCenter, mapVisibleBounds } = this.appState;
    // A style reload (display mode, sectional toggle) after the pilot has panned reloads the current view, not the home view.
    if (this.lastQueryCenter && mapVisibleBounds) {
      const ne = { lat: mapVisibleBounds.north, lon: mapVisibleBounds.east };
      const sw = { lat: mapVisibleBounds.south, lon: mapVisibleBounds.west };
      const low = isLowZoom(mapZoom);
      return this.loadDataForRegion(
        mapCenter,
        cappedRadiusNM(mapCenter, ne, sw),
        low ? lowZoomRadiusNM(mapCenter, ne, sw) : null,
      );
    }
    return this.loadDataForRegion(
      regionDefaultCenter(region),
      MAX_RADIUS_NM,
      isLowZoom(mapZoom) ? MAX_LOW_ZOOM_RADIUS_NM : null,
    );
  }

  /**
   * Debounced (500 ms). Query radius comes from the visible bounds; the database is hit again only when the centre
   * moved > 5 NM or the radius changed > 20% (zoom in place). Only the last change in a burst runs.
   */
  onRegionChanged(center: Coordinate, zoom: number, northEast: Coordinate, southWest: Coordinate): void {
    if (this.disposed) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (!this.pendingRegion) {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => (resolve = r));
      this.pendingRegion = { promise, resolve };
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.applyRegionChange(center, zoom, northEast, southWest);
    }, this.debounceMs);
  }

  /** Completes when the pending debounced region change has been applied (tests use it instead of sleeping). */
  async settleRegionChange(): Promise<void> {
    await this.pendingRegion?.promise;
  }

  private resolvePending(): void {
    const p = this.pendingRegion;
    this.pendingRegion = null;
    p?.resolve();
  }

  private async applyRegionChange(
    center: Coordinate,
    zoom: number,
    northEast: Coordinate,
    southWest: Coordinate,
  ): Promise<void> {
    this.regionRunsInFlight += 1;
    try {
      if (this.disposed) return;
      this.appState.mapCenter = center;
      this.appState.mapZoom = zoom;
      this.appState.mapVisibleBounds = {
        south: southWest.lat,
        west: southWest.lon,
        north: northEast.lat,
        east: northEast.lon,
      };
      const capped = cappedRadiusNM(center, northEast, southWest);
      const low = isLowZoom(zoom);
      const queryRadius = low ? lowZoomRadiusNM(center, northEast, southWest) : capped;
      // Crossing the low-zoom threshold changes what is queried, whatever the geometry says.
      const crossed = low !== this.lastQueryWasLowZoom;
      if (!crossed && !shouldRequery(this.lastQueryCenter, this.lastQueryRadiusNM, center, queryRadius)) {
        this.emit();
        return;
      }
      this.lastQueryCenter = center;
      this.lastQueryRadiusNM = queryRadius;
      this.lastQueryWasLowZoom = low;
      await this.loadDataForRegion(center, capped, low ? queryRadius : null);
    } finally {
      // A newer change may have armed a new pending promise while this one ran; only settle if none is waiting.
      this.regionRunsInFlight -= 1;
      if (!this.debounceTimer && this.regionRunsInFlight === 0) this.resolvePending();
    }
  }

  // MARK: layer toggles

  /** Toggle a layer; a data layer switched on loads just that layer for the current view. */
  async toggleLayer(layer: MapLayer): Promise<void> {
    const { appState } = this;
    if (!regionSupports(appState.region, layer)) return; // no source in this region
    if (appState.visibleLayers.has(layer)) {
      appState.visibleLayers.delete(layer);
      this.emit();
      return;
    }
    appState.visibleLayers.add(layer);
    this.emit();
    const center = appState.mapCenter;
    const queryRadius = this.lastQueryRadiusNM ?? MAX_RADIUS_NM;
    const radius = Math.min(queryRadius, MAX_RADIUS_NM);
    switch (layer) {
      case 'airports':
        await this.loadAirports(center, radius, isLowZoom(appState.mapZoom) ? queryRadius : null);
        break;
      case 'navaids':
        await this.loadNavaids(center, radius);
        break;
      case 'airspace':
        await this.loadAirspaces(center, radius);
        break;
      case 'weatherDots':
        await this.loadWeatherDots();
        break;
      case 'tfrs':
        await this.loadTFRs();
        break;
      case 'advisories':
        await this.loadAdvisories();
        break;
      default:
        break;
    }
  }

  onAirportTapped(icao: string): void {
    this.deps.onAirportSelected?.(icao);
  }

  /**
   * The pilot switched region (AppState already reset centre, zoom and layers): clear data of layers the region has no
   * source for so it cannot read as current, then reload the region's home view. The caller flies the camera to
   * `regionDefaultCenter/Zoom`, suspends follow (`userMoved`) and clears predictions.
   */
  async regionDidChange(): Promise<void> {
    const { region } = this.appState;
    // A queued view change belongs to the old region and would overwrite the new region's reset view.
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.resolvePending();
    const s = { ...this.sources };
    if (!isLayerAvailable(region, 'tfrs')) {
      this.loadedTfrs = [];
      this.tfrFetchedAt = null;
      this.tfrLoadFailed = false;
      this.tfrOverlay = 'current';
      s.tfrs = EMPTY_COLLECTION;
      this.seq.tfrs += 1;
    }
    if (!isLayerAvailable(region, 'advisories')) {
      this.loadedAdvisories = [];
      this.advisoriesFetchedAt = null;
      this.advisoriesLoadFailed = false;
      this.advisoryOverlay = 'current';
      s.advisories = EMPTY_COLLECTION;
      this.seq.advisories += 1;
    }
    if (!isLayerAvailable(region, 'navaids')) {
      this.visibleNavaids = [];
      s.navaids = EMPTY_COLLECTION;
      this.seq.navaids += 1;
    }
    if (!isLayerAvailable(region, 'airspace')) {
      this.visibleAirspaces = [];
      s.airspaces = EMPTY_COLLECTION;
      this.seq.airspaces += 1;
    }
    this.seq.weather += 1;
    this.oldestWeather = null;
    s.weather = EMPTY_COLLECTION;
    this.sources = s;
    this.lastQueryCenter = null;
    this.lastQueryRadiusNM = null;
    this.lastQueryWasLowZoom = null;
    this.emit();
    await this.onMapStyleLoaded();
  }

  // MARK: data loading

  private async loadDataForRegion(center: Coordinate, radius: number, towerRadius: number | null): Promise<void> {
    const { appState } = this;
    const region = appState.region;
    const jobs: Promise<unknown>[] = [];
    let airportsJob: Promise<unknown> = Promise.resolve();
    if (isLayerAvailable(region, 'airports')) {
      airportsJob = this.loadAirports(center, radius, towerRadius);
      jobs.push(airportsJob);
    } else {
      this.seq.airports += 1;
      this.visibleAirports = [];
      this.sources = { ...this.sources, airports: EMPTY_COLLECTION };
      this.emit();
    }
    if (appState.visibleLayers.has('navaids') && isLayerAvailable(region, 'navaids')) {
      jobs.push(this.loadNavaids(center, radius));
    }
    if (appState.visibleLayers.has('airspace') && isLayerAvailable(region, 'airspace')) {
      jobs.push(this.loadAirspaces(center, radius));
    }
    // Weather stations come from the visible airports, so it waits for them (Swift loaded airports synchronously first).
    if (appState.visibleLayers.has('weatherDots')) jobs.push(airportsJob.then(() => this.loadWeatherDots()));
    if (appState.visibleLayers.has('tfrs') && isLayerAvailable(region, 'tfrs')) jobs.push(this.loadTFRs());
    if (appState.visibleLayers.has('advisories') && isLayerAvailable(region, 'advisories')) {
      jobs.push(this.loadAdvisories());
    }
    // One failing layer never aborts the others (each loader catches its own errors).
    await Promise.all(jobs);
  }

  /**
   * Zoomed in: every airport in the (capped) radius, thinned. Zoomed out (`towerRadius` set): towered public airports
   * for the whole visible region, spatially thinned to the visible bounds.
   */
  private async loadAirports(center: Coordinate, radius: number, towerRadius: number | null): Promise<void> {
    const token = ++this.seq.airports;
    this.airportsInFlight += 1;
    this.emit();
    try {
      let shown: Airport[];
      if (towerRadius !== null) {
        const towered = await this.deps.db.toweredAirportsNear(center, towerRadius);
        const b = this.appState.mapVisibleBounds;
        shown = b ? thinSpatially(towered, b) : towered;
      } else {
        shown = thin(await this.deps.db.airportsNear(center, radius), center);
      }
      if (token !== this.seq.airports || this.disposed) return;
      this.visibleAirports = shown;
      this.sources = { ...this.sources, airports: airportFeatures(shown) };
    } catch {
      if (token === this.seq.airports) this.lastError = { kind: 'databaseCorrupted' };
    } finally {
      this.airportsInFlight -= 1;
      this.emit();
    }
  }

  private async loadNavaids(center: Coordinate, radius: number): Promise<void> {
    const token = ++this.seq.navaids;
    try {
      const navaids = await this.deps.db.navaidsNear(center, radius);
      if (token !== this.seq.navaids || this.disposed) return;
      this.visibleNavaids = navaids;
      this.sources = { ...this.sources, navaids: navaidFeatures(navaids) };
      this.emit();
    } catch {
      // Non-critical: continue without navaids.
    }
  }

  private async loadAirspaces(center: Coordinate, radius: number): Promise<void> {
    const token = ++this.seq.airspaces;
    try {
      const airspaces = await this.deps.db.airspacesNear(center, Math.min(radius, MAX_AIRSPACE_RADIUS_NM));
      if (token !== this.seq.airspaces || this.disposed) return;
      this.visibleAirspaces = airspaces;
      this.sources = { ...this.sources, airspaces: airspaceFeatures(airspaces) };
      this.emit();
    } catch {
      // Non-critical: continue without airspaces.
    }
  }

  /** Fetch weather for visible airports plus the region's own METAR stations. Returns whether it succeeded. */
  async loadWeatherDots(): Promise<boolean> {
    const weather = this.deps.weather;
    if (!weather) return false;
    const token = ++this.seq.weather;
    const ids: string[] = this.visibleAirports.map((a) => a.icao);
    const coords = new Map<string, Coordinate>();
    for (const a of this.visibleAirports) coords.set(a.icao, { lat: a.latitude, lon: a.longitude });
    for (const s of weatherStations(this.appState.region)) {
      if (s.hasMetar && !coords.has(s.id)) {
        ids.push(s.id);
        coords.set(s.id, { lat: s.lat, lon: s.lon });
      }
    }
    if (ids.length === 0) return false;
    try {
      const wx = await weather.fetchWeatherForStations(ids);
      if (token !== this.seq.weather || this.disposed) return false;
      this.sources = { ...this.sources, weather: weatherDotFeatures(wx, coords) };
      const times = wx.map((w) => w.observationTime).filter((t): t is number => t != null);
      this.oldestWeather = times.length ? Math.min(...times) : null;
      this.weatherFetchedAt = this.now();
      this.emit();
      return true;
    } catch {
      return false; // Non-critical: dots just will not update.
    }
  }

  async loadTFRs(): Promise<void> {
    const src = this.deps.tfr;
    if (!src) return;
    const token = ++this.seq.tfrs;
    try {
      const snapshot = await src.currentTFRs();
      if (token !== this.seq.tfrs || this.disposed) return;
      this.loadedTfrs = snapshot.tfrs;
      this.tfrFetchedAt = snapshot.fetchedAt;
      this.tfrLoadFailed = false;
      this.drawTFRs();
    } catch {
      if (token !== this.seq.tfrs) return;
      this.tfrLoadFailed = true; // the service already falls back to its cache; nothing was ever fetched
      this.emit();
    }
  }

  async loadAdvisories(): Promise<void> {
    const src = this.deps.advisories;
    if (!src) return;
    const token = ++this.seq.advisories;
    try {
      const snapshot = await src.currentAdvisories();
      if (token !== this.seq.advisories || this.disposed) return;
      this.loadedAdvisories = snapshot.advisories;
      this.advisoriesFetchedAt = snapshot.fetchedAt;
      this.advisoriesLoadFailed = false;
      this.drawAdvisories();
    } catch {
      if (token !== this.seq.advisories) return;
      this.advisoriesLoadFailed = true;
      this.emit();
    }
  }

  /** Stale is marked, expired is not drawn. */
  private drawTFRs(nowMs: number = this.now()): void {
    this.tfrOverlay = evaluateOverlayStaleness('tfr', this.tfrFetchedAt, nowMs);
    const fc =
      this.tfrOverlay === 'hidden'
        ? EMPTY_COLLECTION
        : tfrFeatures(this.loadedTfrs, nowMs, this.tfrOverlay === 'stale');
    this.sources = { ...this.sources, tfrs: fc };
    this.emit();
  }

  private drawAdvisories(nowMs: number = this.now()): void {
    this.advisoryOverlay = evaluateOverlayStaleness('airmetSigmet', this.advisoriesFetchedAt, nowMs);
    const valid = this.loadedAdvisories.filter((a) => advisoryIsValid(a, nowMs));
    const fc =
      this.advisoryOverlay === 'hidden' ? EMPTY_COLLECTION : advisoryFeatures(valid, this.advisoryOverlay === 'stale');
    this.sources = { ...this.sources, advisories: fc };
    this.emit();
  }

  /** Redraw an overlay only when its age class changed, so a snapshot never stays drawn as current. */
  refreshOverlayStaleness(nowMs: number = this.now()): void {
    // Redraw when the age class changed OR an item crossed its own expiry/validity while the class stayed the same.
    const tfrClass = evaluateOverlayStaleness('tfr', this.tfrFetchedAt, nowMs);
    const tfrShown = this.sources.tfrs.features.length;
    if (
      tfrClass !== this.tfrOverlay ||
      (tfrClass !== 'hidden' && tfrFeatures(this.loadedTfrs, nowMs).features.length !== tfrShown)
    ) {
      this.drawTFRs(nowMs);
    }
    const advClass = evaluateOverlayStaleness('airmetSigmet', this.advisoriesFetchedAt, nowMs);
    const advShown = this.sources.advisories.features.length;
    const advNow = this.loadedAdvisories.filter((a) => advisoryIsValid(a, nowMs));
    if (
      advClass !== this.advisoryOverlay ||
      (advClass !== 'hidden' && advisoryFeatures(advNow).features.length !== advShown)
    ) {
      this.drawAdvisories(nowMs);
    }
  }

  // MARK: basemap tile health

  noteTileError(): void {
    this.tileTracker = recordTileError(this.tileTracker);
    if (isTileFailing(this.tileTracker) && !this.tilesFailing) {
      this.tilesFailing = true;
      this.emit();
    }
  }

  noteTileLoadedFromNetwork(): void {
    this.tileTracker = recordTileNetworkLoad();
    if (this.tilesFailing) {
      this.tilesFailing = false;
      this.emit();
    }
  }
}
