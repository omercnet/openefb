// Fixture TFR and advisory for the `map-layers` capture state (every data layer on over the KPAO-KOAK scenario).
// Rings are [lat, lon]. Times are far in the future so the capture never ages out; `fetchedAt` is injected by the caller.
import type { Tfr } from '../domain/core';
import type { MapAdvisory } from '../domain/map/features';

export const FAR_FUTURE_MS = 4_102_444_800_000; // 2100-01-01

export const fixtureTfr: Tfr = {
  id: 'fixture-tfr',
  notamID: '6/0001',
  type: 'HAZARDS',
  title: 'Fixture TFR',
  effectiveDate: 0,
  expirationDate: FAR_FUTURE_MS,
  boundaries: [
    [37.55, -122.35],
    [37.55, -122.2],
    [37.42, -122.2],
    [37.42, -122.35],
  ],
};

export const fixtureAdvisory: MapAdvisory = {
  id: 'fixture-airmet',
  kind: 'airmet',
  hazardCode: 'IFR',
  colorHex: '#FF9500',
  validFrom: 0,
  validTo: FAR_FUTURE_MS,
  boundaries: [
    [37.9, -122.2],
    [37.9, -121.8],
    [37.65, -121.8],
    [37.65, -122.2],
  ],
};
