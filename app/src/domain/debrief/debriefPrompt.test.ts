// How DebriefView.generateDebrief gets its prompt (efb-212/Views/Flights/DebriefView.swift): the CVFR facts, when the flight was
// flown on the Israel network, go into FlightSummaryBuilder's prompt. Loading the CVFR debrief never fails the prompt (Swift's
// loadBundled swallows its errors); reading the recording database does.
import { sampleCvfrDebrief } from './cvfrFixture';
import { promptFacts } from './cvfrDebrief';
import { debriefPrompt } from './debriefPrompt';
import { buildPromptForFlight, type DebriefDataSource } from './flightSummaryBuilder';
import type { FlightMetadata } from './types';

const metadata: FlightMetadata = {
  aircraftType: null,
  pilotName: null,
  departureICAO: 'LLHA',
  arrivalICAO: 'LLMG',
  date: 1_790_000_000_000,
  durationSeconds: 900,
};

const source: DebriefDataSource = {
  phaseMarkers: async () => [{ phase: 'cruise', startTimestamp: 1_790_000_000_000, endTimestamp: null }],
  trackPoints: async () => [
    { timestamp: 1_790_000_000_000, latitude: 32.8, longitude: 35.04, altitudeFeet: 1500, groundSpeedKnots: 100 },
  ],
  transcriptSegments: async () => [{ text: 'Passing Kishon', confidence: 0.9, flightPhase: 'cruise' }],
};

describe('debriefPrompt', () => {
  const cvfr = sampleCvfrDebrief();
  const facts = promptFacts(cvfr);

  it('puts the CVFR facts of the flight into the prompt', async () => {
    expect(facts).not.toBeNull();
    const prompt = await debriefPrompt({ flightId: 'flight-1', metadata, source, loadCvfr: async () => cvfr });
    expect(prompt).toBe(await buildPromptForFlight('flight-1', source, metadata, facts));
    expect(prompt).toContain(facts!);
  });

  it('is the plain prompt for a flight with no CVFR debrief', async () => {
    const prompt = await debriefPrompt({ flightId: 'flight-1', metadata, source, loadCvfr: async () => null });
    expect(prompt).toBe(await buildPromptForFlight('flight-1', source, metadata, null));
  });

  it('is the plain prompt when the CVFR debrief cannot be loaded (Swift swallows that error)', async () => {
    const prompt = await debriefPrompt({
      flightId: 'flight-1',
      metadata,
      source,
      loadCvfr: async () => {
        throw new Error('the Israel database could not be opened');
      },
    });
    expect(prompt).toBe(await buildPromptForFlight('flight-1', source, metadata, null));
  });

  it('fails when the recording database cannot be read, so the pilot can retry', async () => {
    const broken: DebriefDataSource = {
      ...source,
      trackPoints: async () => {
        throw new Error('disk I/O error');
      },
    };
    await expect(
      debriefPrompt({ flightId: 'flight-1', metadata, source: broken, loadCvfr: async () => null }),
    ).rejects.toThrow('disk I/O error');
  });

  it('reads the flight it is asked for', async () => {
    const asked: string[] = [];
    const spying: DebriefDataSource = {
      phaseMarkers: async (id) => (asked.push(id), []),
      trackPoints: async (id) => (asked.push(id), []),
      transcriptSegments: async (id) => (asked.push(id), []),
    };
    await debriefPrompt({ flightId: 'flight-42', metadata, source: spying, loadCvfr: async () => null });
    expect(new Set(asked)).toEqual(new Set(['flight-42']));
  });
});
