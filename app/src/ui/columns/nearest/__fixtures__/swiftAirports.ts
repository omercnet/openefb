// The airports of efb-212Tests/ViewModelTests/NearestAirportViewModelTests.swift (kpao, ksql, ksfo), shared by the ports.
import { makeAirport } from '../../../../domain/core';

export const rwy = (
  id: string,
  length: number,
  width: number,
  surface: 'asphalt' | 'concrete',
  lat: number,
  lon: number,
) => {
  const [baseEndID = id, reciprocalEndID = ''] = id.split('/');
  return {
    id,
    length,
    width,
    surface,
    lighting: 'fullTime' as const,
    baseEndID,
    reciprocalEndID,
    baseEndLatitude: lat,
    baseEndLongitude: lon,
    reciprocalEndLatitude: lat,
    reciprocalEndLongitude: lon,
  };
};

export const kpao = makeAirport({
  icao: 'KPAO',
  faaID: 'PAO',
  name: 'Palo Alto',
  latitude: 37.4611,
  longitude: -122.115,
  elevation: 4,
  type: 'airport',
  ownership: 'public',
  ctafFrequency: 118.6,
  patternAltitude: 800,
  fuelTypes: ['100LL'],
  hasBeaconLight: true,
  runways: [rwy('13/31', 2443, 70, 'asphalt', 37.4585, -122.112)],
  frequencies: [{ id: 'F1', type: 'ctaf', frequency: 118.6, name: 'Palo Alto CTAF' }],
});
export const ksql = makeAirport({
  icao: 'KSQL',
  faaID: 'SQL',
  name: 'San Carlos',
  latitude: 37.5119,
  longitude: -122.2494,
  elevation: 5,
  type: 'airport',
  ownership: 'public',
  ctafFrequency: 119.0,
  patternAltitude: 800,
  fuelTypes: ['100LL'],
  hasBeaconLight: true,
  runways: [rwy('12/30', 2600, 75, 'asphalt', 37.509, -122.245)],
});
export const ksfo = makeAirport({
  icao: 'KSFO',
  faaID: 'SFO',
  name: 'San Francisco Intl',
  latitude: 37.6213,
  longitude: -122.379,
  elevation: 13,
  type: 'airport',
  ownership: 'public',
  ctafFrequency: null,
  patternAltitude: 1000,
  fuelTypes: ['100LL', 'Jet-A'],
  hasBeaconLight: true,
  runways: [rwy('10L/28R', 11870, 200, 'asphalt', 37.6286, -122.393)],
  frequencies: [{ id: 'F2', type: 'tower', frequency: 120.5, name: 'SFO Tower' }],
});
