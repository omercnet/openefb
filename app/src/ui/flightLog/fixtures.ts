// Fake flight log data. `dayFixture` reproduces app/reference/ipad-map-day.png (and, in the Night palette,
// ipad-map-night.png): KPAO -> KOAK direct, ownship over Redwood City, NEXT 9:12 KOAK "14.9 NM . 349deg . ETA 18:11",
// NOW GS 96 TRK 296 ALT 680 +475 on a 0 to 4,000 ft tape, recording for 6 s. The other fixtures cover the Swift states.
import type { PredictedEvent } from '../../domain/prediction';
import { makeActiveRoute, makeLeg, type ActiveRoute } from '../../domain/route';
import type { FlightLogActions, FlightLogData } from './store';

const noop = () => {};
export const noActions: FlightLogActions = {
  clear: noop,
  sequenceRoute: noop,
  openLog: noop,
  openBriefing: noop,
  record: noop,
  openSettings: noop,
};

/** Seconds to KOAK: 9:12. */
const ETE_S = 552;
/** 2026-11-08 18:01:48 PST: ETA 18:11 at 9:12 to go. */
const NOW_MS = Date.UTC(2026, 10, 9, 2, 11, 0) - ETE_S * 1000;

export const dayFixture: FlightLogData = {
  region: 'us',
  directTo: 'KOAK',
  activeFlightPlan: true, // NearestAirportViewModel.setDirectTo sets both
  activeRoute: null,
  planDeparture: null,
  planDestination: null,
  gpsAvailable: true,
  hasPosition: true,
  hasAltitude: true,
  groundSpeed: 96, // knots
  track: 296, // degrees true
  altitude: 680, // feet MSL
  verticalSpeed: 475, // feet per minute
  distanceToNext: 14.9, // NM
  bearingToNext: 349, // degrees true
  estimatedTimeEnroute: ETE_S,
  predictedEvents: [],
  nowMs: NOW_MS,
  timeZone: 'America/Los_Angeles',
  recording: { status: { kind: 'recording' }, elapsedSeconds: 6, levelDBFS: -160, microphoneDenied: false },
  recordingUnavailable: false,
  isOffline: false,
  airspaceCheckUnavailable: false,
  israelAlertsSuspended: false,
  actions: noActions,
};

/** Nothing active: NEXT shows the nearest airport and Plan a flight, NOW only the readouts. */
export const noNavigationFixture: FlightLogData = {
  ...dayFixture,
  directTo: null,
  activeFlightPlan: false,
  distanceToNext: null,
  bearingToNext: null,
  estimatedTimeEnroute: null,
};

/** An Israel CVFR route on its second leg (LLHZ departed, MIDAA passed), off route and 350 ft low. */
export const israelRoute: ActiveRoute = makeActiveRoute(
  [
    makeLeg({
      fromCode: 'LLHZ',
      toCode: 'MIDAA',
      toLatitude: 32.25,
      toLongitude: 34.85,
      altitudeText: '1500',
      distanceNM: 9,
    }),
    makeLeg({
      fromCode: 'MIDAA',
      toCode: 'BAZRA',
      toLatitude: 32.1,
      toLongitude: 34.95,
      altitudeText: '2500',
      distanceNM: 12,
    }),
    makeLeg({
      fromCode: 'BAZRA',
      toCode: 'NATAN',
      toLatitude: 31.9,
      toLongitude: 35.0,
      altitudeText: '3000',
      distanceNM: 15,
    }),
    makeLeg({
      fromCode: 'NATAN',
      toCode: 'LLIB',
      toLatitude: 31.6,
      toLongitude: 35.1,
      altitudeText: '3500',
      distanceNM: 18,
    }),
  ],
  {
    currentLeg: 1,
    following: {
      crossTrackNM: 1.2,
      side: 'R',
      isOffRoute: true,
      altitudeDeviationFeet: -350,
      altitudeDeviationSince: null,
      isAltitudeCaution: true,
      nextPointETA: Date.UTC(2026, 10, 9, 13, 41, 0), // 15:41 in Israel
    },
  },
);

export const routeFixture: FlightLogData = {
  ...dayFixture,
  region: 'israel',
  directTo: null,
  activeFlightPlan: true,
  activeRoute: israelRoute,
  planDeparture: 'LLHZ',
  planDestination: 'LLIB',
  groundSpeed: 90,
  distanceToNext: 4.5,
  bearingToNext: 120,
  estimatedTimeEnroute: 180,
  timeZone: 'UTC',
};

const prediction = (
  p: Partial<PredictedEvent> & Pick<PredictedEvent, 'volumeID' | 'secondsAhead'>,
): PredictedEvent => ({
  kind: 'floor',
  severity: 'caution',
  coordinate: { lat: 37.5, lon: -122.2 },
  limitFeetMSL: 3000,
  title: 'B floor 3,000',
  assumption: 'at 312\u00B0, +300 fpm',
  ...p,
});

/** Stage 2: a Class B floor before KOAK, then two later entries. */
export const predictedEvents: PredictedEvent[] = [
  prediction({ volumeID: 'B', secondsAhead: 110 }),
  prediction({ volumeID: 'C', secondsAhead: 600, limitFeetMSL: 1500, title: 'C floor 1,500' }),
  prediction({
    volumeID: 'R',
    kind: 'lateral',
    severity: 'warning',
    secondsAhead: 700,
    limitFeetMSL: null,
    title: 'R 107',
  }),
];
