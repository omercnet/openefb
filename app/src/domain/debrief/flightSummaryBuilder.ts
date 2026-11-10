// Port of efb-212/Services/Debrief/FlightSummaryBuilder.swift: token-budgeted compression of a recorded flight into a
// prompt under ~3,000 tokens (12,600 chars at 4.2 chars/token).
// "Character" counts use Unicode code points; Swift counts grapheme clusters. Identical for the ASCII prompts built here.

import { describeMetadata, type DateFormatFn } from './debriefRecord';
import type { DebriefPhaseMarker, DebriefTrackPoint, DebriefTranscriptSegment, FlightMetadata } from './types';

export const maxSummaryChars = 12_600;
export const perPhaseCharBudget = 1_050;
export const metadataCharBudget = 1_260;
export const cvfrCharBudget = 1_800;

const chars = (s: string): string[] => Array.from(s);
const count = (s: string): number => chars(s).length;
const prefix = (s: string, n: number): string => chars(s).slice(0, Math.max(0, n)).join('');

/** What buildPrompt reads from the recording store when called with a flight id. */
export interface DebriefDataSource {
  phaseMarkers(flightID: string): Promise<DebriefPhaseMarker[]>;
  trackPoints(flightID: string): Promise<DebriefTrackPoint[]>;
  transcriptSegments(flightID: string): Promise<DebriefTranscriptSegment[]>;
}

export async function buildPromptForFlight(
  flightID: string,
  source: DebriefDataSource,
  metadata: FlightMetadata,
  cvfrFacts: string | null = null,
  formatDate?: DateFormatFn,
): Promise<string> {
  const phaseMarkers = await source.phaseMarkers(flightID);
  const trackPoints = await source.trackPoints(flightID);
  const transcriptSegments = await source.transcriptSegments(flightID);
  return buildPrompt({ trackPoints, transcriptSegments, phaseMarkers, metadata, cvfrFacts, formatDate });
}

export interface BuildPromptInput {
  trackPoints: DebriefTrackPoint[];
  transcriptSegments: DebriefTranscriptSegment[];
  phaseMarkers: DebriefPhaseMarker[];
  metadata: FlightMetadata;
  cvfrFacts?: string | null;
  formatDate?: DateFormatFn;
}

export function buildPrompt(input: BuildPromptInput): string {
  const { trackPoints, transcriptSegments, phaseMarkers, metadata } = input;
  const cvfrFacts = input.cvfrFacts ?? null;

  let metadataHeader = describeMetadata(metadata, input.formatDate);
  if (count(metadataHeader) > metadataCharBudget) {
    metadataHeader = prefix(metadataHeader, metadataCharBudget - 3) + '...';
  }

  const forPhase = (phase: DebriefPhaseMarker) => ({
    points: trackPoints.filter(
      (p) => p.timestamp >= phase.startTimestamp && (phase.endTimestamp === null || p.timestamp <= phase.endTimestamp),
    ),
    transcripts: transcriptSegments.filter((s) => s.flightPhase === phase.phase),
  });

  let phaseSummaries = phaseMarkers.map((phase) => {
    const { points, transcripts } = forPhase(phase);
    return summarizePhase(phase, points, transcripts);
  });

  // CVFR facts (numbers computed in code) are kept whole; the phase summaries are trimmed to fit.
  const cvfrBlock = cvfrFacts === null ? '' : '\n\n' + prefix(cvfrFacts, cvfrCharBudget);
  const instruction =
    cvfrFacts === null
      ? ''
      : '\n\nThe CVFR ROUTE block holds measured facts; use its numbers as given and do not invent others.';

  const assemble = (): string =>
    `Analyze this flight and provide a structured debrief.\n\nFlight: ${metadataHeader}\n\n${phaseSummaries.join('\n\n')}${cvfrBlock}${instruction}`;

  let prompt = assemble();

  // If the total exceeds the budget, proportionally trim the phase summaries.
  if (count(prompt) > maxSummaryChars) {
    const overhead = count(prompt) - maxSummaryChars;
    const trimPerPhase = phaseSummaries.length === 0 ? 0 : Math.trunc(overhead / phaseSummaries.length) + 1;
    const newBudget = Math.max(100, perPhaseCharBudget - trimPerPhase);

    phaseSummaries = phaseMarkers.map((phase) => {
      const { points, transcripts } = forPhase(phase);
      let summary = summarizePhaseRaw(phase, points, transcripts);
      if (count(summary) > newBudget) summary = prefix(summary, newBudget - 3) + '...';
      return summary;
    });

    prompt = assemble();
  }

  return prompt;
}

/** Summarize one phase within the per-phase character budget. */
export function summarizePhase(
  phase: DebriefPhaseMarker,
  trackPoints: DebriefTrackPoint[],
  transcripts: DebriefTranscriptSegment[],
): string {
  let summary = summarizePhaseRaw(phase, trackPoints, transcripts);
  if (count(summary) > perPhaseCharBudget) summary = prefix(summary, perPhaseCharBudget - 3) + '...';
  return summary;
}

function summarizePhaseRaw(
  phase: DebriefPhaseMarker,
  trackPoints: DebriefTrackPoint[],
  transcripts: DebriefTranscriptSegment[],
): string {
  const avg = (f: (p: DebriefTrackPoint) => number): number =>
    trackPoints.length === 0 ? 0 : trackPoints.reduce((s, p) => s + f(p), 0) / trackPoints.length;
  const avgAlt = avg((p) => p.altitudeFeet);
  const avgSpeed = avg((p) => p.groundSpeedKnots);
  const duration = phase.endTimestamp === null ? 0 : (phase.endTimestamp - phase.startTimestamp) / 1000;

  // Top 3 by confidence, interruption markers excluded; unknown confidence sorts below every scored segment.
  const topTranscripts = transcripts
    .filter((t) => !t.text.startsWith('[INTERRUPTION:'))
    .sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1))
    .slice(0, 3)
    .map((t) => t.text);

  let summary = `[${phase.phase.toUpperCase()}] Duration: ${Math.trunc(duration)}s, Avg Alt: ${Math.trunc(avgAlt)}ft, Avg GS: ${Math.trunc(avgSpeed)}kts`;
  if (topTranscripts.length > 0) summary += '\nComms: ' + topTranscripts.join(' | ');
  return summary;
}
