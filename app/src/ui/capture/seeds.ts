// What the fixture capture routes (kanaf-dev://airport, nearest, night, ...) put in the slices so the screenshot gate
// compares like with like. Production slices start empty and the app shell feeds them; only a MapScreen opened with a
// `screen` (the capture routes) and the tests that render the reference screens seed these.
import { airport } from '../columns/airport/store';
import { KSQL_COLUMN, KSQL_NOW } from '../columns/airport/fixture';
import { FIXTURE_AIRPORTS, FIXTURE_OWNSHIP, createFakeAviationDatabase } from '../columns/nearest/fixture';
import { LIST_COUNT, MINIMUM_RUNWAY_LENGTH_FEET, rankLandable } from '../columns/nearest/logic';
import { nearest } from '../columns/nearest/store';
import type { AirportQueries } from '../columns/nearest/sources';
import { dayFixture } from '../flightLog/fixtures';
import { flightLog } from '../flightLog/store';
import { layers } from '../columns/layers/store';
import { gps } from '../state/gps';

/** The Nearest and Search columns' reference airports, as an in-memory database. */
export const captureAirportQueries = (): AirportQueries => ({
  aviation: createFakeAviationDatabase(),
  israel: null,
  fetchNotamClosures: null,
  now: () => Date.now(),
});

/** Writes the reference data (KSQL column, ten nearest airports, a good fix, the day flight log) into the default slices. */
export function applyCaptureSeeds(): void {
  airport.store.setState({ now: KSQL_NOW, columns: { KSQL: KSQL_COLUMN } });
  nearest.store.setState({
    entries: rankLandable(FIXTURE_AIRPORTS, FIXTURE_OWNSHIP, MINIMUM_RUNWAY_LENGTH_FEET, LIST_COUNT),
    loading: false,
    error: null,
    ownship: FIXTURE_OWNSHIP,
  });
  gps.store.setState({ status: { kind: 'ok' }, failure: null });
  flightLog.store.setState(dayFixture);
  applyLayersCaptureSeed();
}

const LAYERS_NOW = Date.UTC(2026, 10, 12, 0, 35); // 4:35 PM PST, 11 Nov 2026

/** The Layers column reference (reference/ipad-layers.png): its clock, chart cycle and data ages. */
export function applyLayersCaptureSeed(): void {
  layers.store.setState({
    displayMode: 'day',
    visibleLayers: ['sectional', 'tfrs', 'weatherDots', 'route', 'ownship'],
    sectionalCycleExpires: Date.UTC(2026, 11, 24, 9, 1),
    chartExpiration: Date.UTC(2026, 11, 24, 9, 1),
    tfrFetchedAt: LAYERS_NOW - 20_000,
    oldestWeatherObservation: LAYERS_NOW - 48 * 60_000,
    now: LAYERS_NOW,
  });
}
