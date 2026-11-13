// Deterministic fakes for the fidelity captures of the flight detail, CVFR and AI debrief screens (kanaf-dev://flightdetail, cvfr,
// debrief) and the web preview: a 15 minute flight from Haifa to Megiddo with its CVFR debrief (the sample of the domain tests), a
// debrief engine that never calls a model, and a recording store on fakes. Real wiring is the shell's.
import { sampleCvfrDebrief } from '../../domain/debrief/cvfrFixture';
import type { FlightDebrief } from '../../domain/debrief/types';
import { FakeDebriefEngine, type DebriefAvailability, type GenerationScript } from '../../domain/ports/debriefEngine';
import { createDebriefStore, type DebriefViewStore } from '../state/debriefStore';
import { createFlightDetailStore, type FlightDetailStore } from '../state/flightDetailStore';
import type { FlightDetailFlight } from '../flights/FlightDetailScreen';
import { captureRecordingLab, type RecordingLab } from './captureRecordingFixtures';

const START = 1_790_000_000_000;

export const CAPTURE_DETAIL_FLIGHT: FlightDetailFlight = {
  id: 'capture-flight-detail',
  startDate: START,
  departureICAO: 'LLHA',
  arrivalICAO: 'LLMG',
  departureName: 'Haifa',
  arrivalName: 'Megiddo',
  durationSeconds: 900,
  notes: null,
  trackPointCount: 900,
  transcriptSegmentCount: 6,
  audioQuality: 'standard',
  hasDebrief: false,
};

/** A flight the debrief has nothing to work with: under a minute, no transcript. */
export const CAPTURE_SHORT_FLIGHT: FlightDetailFlight = {
  ...CAPTURE_DETAIL_FLIGHT,
  durationSeconds: 48,
  trackPointCount: 48,
  transcriptSegmentCount: 0,
};

export const CAPTURE_DEBRIEF: FlightDebrief = {
  narrativeSummary:
    'A 15 minute flight from Haifa to Megiddo in good conditions. The departure and the first leg were flown tidily; the second leg ran about 350 ft below the published altitude for three minutes, and the call at Afula was not heard.',
  phaseObservations: [
    { phase: 'taxi', observations: ['Taxi request was clear and acknowledged.'], executedWell: true },
    { phase: 'takeoff', observations: ['Smooth rotation at 62 kt.', 'Climb held at 74 kt.'], executedWell: true },
    {
      phase: 'cruise',
      observations: ['Altitude drifted to 2150 ft against a published 2500 ft between Kishon and Afula.'],
      executedWell: false,
    },
    {
      phase: 'landing',
      observations: ['Stabilised approach, touchdown within the first third of the runway.'],
      executedWell: true,
    },
  ],
  improvements: ['Re-trim after the climb to hold the published altitude.', 'Report Afula on the radio.'],
  overallRating: 4,
};

/** Streams the debrief in parts, a moment apart (the web preview's Regenerate; nothing in a native capture starts it). */
const streaming: GenerationScript = async (engine) => {
  const parts = [
    { narrativeSummary: 'A 15 minute flight from Haifa' },
    { narrativeSummary: CAPTURE_DEBRIEF.narrativeSummary, phaseObservations: [{ phase: 'taxi', executedWell: true }] },
    {
      narrativeSummary: CAPTURE_DEBRIEF.narrativeSummary,
      phaseObservations: CAPTURE_DEBRIEF.phaseObservations.slice(0, 3),
      improvements: [CAPTURE_DEBRIEF.improvements[0]!],
    },
  ];
  for (const part of parts) {
    engine.emit({ partial: part });
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  return CAPTURE_DEBRIEF;
};

export interface DetailLab {
  store: FlightDetailStore;
  engine: FakeDebriefEngine | null;
  recording: RecordingLab;
}

export function captureDetailLab(availability: DebriefAvailability = { kind: 'available' }): DetailLab {
  const engine = new FakeDebriefEngine(availability);
  const store = createFlightDetailStore({ engine, loadCvfr: async () => sampleCvfrDebrief(START) });
  return { store, engine, recording: captureRecordingLab() };
}

/** The preview's model switch: what the platform says the next time the screen asks, and now. */
export function setAvailability(lab: DetailLab, availability: DebriefAvailability): void {
  if (lab.engine === null) return;
  lab.engine.availability = availability;
  lab.engine.checkAvailability();
}

export interface DebriefLab {
  store: DebriefViewStore;
  engine: FakeDebriefEngine;
}

export function captureDebriefLab(): DebriefLab {
  const engine = new FakeDebriefEngine({ kind: 'available' }, CAPTURE_DEBRIEF, streaming);
  const store = createDebriefStore({
    engine,
    flightId: CAPTURE_DETAIL_FLIGHT.id,
    buildPrompt: async () => 'capture prompt',
  });
  return { store, engine };
}
