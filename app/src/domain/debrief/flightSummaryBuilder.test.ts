// Port of efb-212Tests/ServiceTests/FlightSummaryBuilderTests.swift (6 cases, same data).
import { buildPrompt, maxSummaryChars, perPhaseCharBudget, summarizePhase } from './flightSummaryBuilder';
import type { DebriefPhaseMarker, DebriefTrackPoint, DebriefTranscriptSegment, FlightMetadata } from './types';

// Swift: Date(timeIntervalSinceReferenceDate: 0) = 2001-01-01T00:00:00Z
const baseDate = Date.UTC(2001, 0, 1);
const allPhases = ['preflight', 'taxi', 'takeoff', 'departure', 'cruise', 'approach', 'landing', 'postflight'];

const testMetadata: FlightMetadata = {
  aircraftType: 'C172',
  pilotName: 'Test Pilot',
  departureICAO: 'KSFO',
  arrivalICAO: 'KSJC',
  date: baseDate,
  durationSeconds: 2400,
};

function makeEightPhaseMarkers(): DebriefPhaseMarker[] {
  return allPhases.map((phase, index) => ({
    phase,
    startTimestamp: baseDate + index * 300 * 1000,
    endTimestamp: baseDate + (index + 1) * 300 * 1000,
  }));
}

function makeTrackPoints(
  phase: DebriefPhaseMarker,
  count = 10,
  altitudeFeet = 5000,
  groundSpeedKnots = 120,
): DebriefTrackPoint[] {
  const durationMs = phase.endTimestamp === null ? 300_000 : phase.endTimestamp - phase.startTimestamp;
  return Array.from({ length: count }, (_, i) => ({
    timestamp: phase.startTimestamp + (durationMs * i) / count,
    latitude: 37.5,
    longitude: -122.0,
    altitudeFeet: altitudeFeet + i * 10,
    groundSpeedKnots: groundSpeedKnots + i,
  }));
}

function makeTranscripts(phase: string, texts: string[], confidences: number[]): DebriefTranscriptSegment[] {
  const n = Math.min(texts.length, confidences.length); // Swift zip
  return Array.from({ length: n }, (_, i) => ({ text: texts[i]!, confidence: confidences[i]!, flightPhase: phase }));
}

const cruise: DebriefPhaseMarker = { phase: 'cruise', startTimestamp: baseDate, endTimestamp: baseDate + 600_000 };

describe('FlightSummaryBuilder Tests', () => {
  test('8-phase flight prompt is under 12,600 characters (3,000 token budget)', () => {
    const phases = makeEightPhaseMarkers();
    const trackPoints = phases.flatMap((p) => makeTrackPoints(p));
    const transcriptSegments = phases.flatMap((p) =>
      makeTranscripts(
        p.phase,
        [
          'Cleared for takeoff runway 28L',
          'Turn left heading 270',
          'Contact NorCal approach',
          'Descending to three thousand',
        ],
        [0.95, 0.88, 0.92, 0.85],
      ),
    );
    const prompt = buildPrompt({ trackPoints, transcriptSegments, phaseMarkers: phases, metadata: testMetadata });
    expect(Array.from(prompt).length).toBeLessThanOrEqual(maxSummaryChars);
    expect(prompt.length).toBeGreaterThan(0);
  });

  test('Single cruise phase produces valid prompt containing [CRUISE] header', () => {
    const prompt = buildPrompt({
      trackPoints: makeTrackPoints(cruise, 10, 8500, 110),
      transcriptSegments: [],
      phaseMarkers: [cruise],
      metadata: testMetadata,
    });
    expect(prompt).toContain('[CRUISE]');
    expect(prompt).toContain('Avg Alt:');
    expect(prompt).toContain('Avg GS:');
  });

  test('Phase summary truncates to perPhaseCharBudget when input exceeds budget', () => {
    const longText = 'Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel '.repeat(30);
    const summary = summarizePhase(
      cruise,
      makeTrackPoints(cruise),
      makeTranscripts('cruise', [longText, longText, longText], [0.95, 0.9, 0.85]),
    );
    expect(Array.from(summary).length).toBeLessThanOrEqual(perPhaseCharBudget);
    expect(summary.endsWith('...')).toBe(true);
  });

  test('Interruption segments excluded from top-3 transcript selection', () => {
    const summary = summarizePhase(
      cruise,
      makeTrackPoints(cruise),
      makeTranscripts(
        'cruise',
        ['[INTERRUPTION: phoneCall]', "Traffic 12 o'clock 3 miles", 'Roger, looking for traffic', 'Traffic in sight'],
        [1.0, 0.95, 0.88, 0.82],
      ),
    );
    expect(summary).not.toContain('[INTERRUPTION:');
    expect(summary).toContain("Traffic 12 o'clock 3 miles");
    expect(summary).toContain('Roger, looking for traffic');
    expect(summary).toContain('Traffic in sight');
  });

  test('Unscored (nil confidence) segments rank below scored ones in top-3 selection', () => {
    const seg = (text: string, confidence: number | null): DebriefTranscriptSegment => ({
      text,
      confidence,
      flightPhase: 'cruise',
    });
    const summary = summarizePhase(cruise, makeTrackPoints(cruise), [
      seg('unscored first', null),
      seg('scored low', 0.1),
      seg('scored mid', 0.5),
      seg('scored high', 0.9),
    ]);
    expect(summary).toContain('scored high');
    expect(summary).toContain('scored mid');
    expect(summary).toContain('scored low');
    expect(summary).not.toContain('unscored first');
  });

  test('Empty track points and transcripts produces valid prompt without crash', () => {
    const prompt = buildPrompt({ trackPoints: [], transcriptSegments: [], phaseMarkers: [], metadata: testMetadata });
    expect(prompt).toContain('Analyze this flight');
    expect(prompt).toContain('Flight:');
    expect(prompt.length).toBeGreaterThan(0);
  });
});
