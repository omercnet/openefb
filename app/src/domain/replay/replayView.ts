import type { RecordingStatus } from '../recording/recordingCoordinator';

// The rules of the replay screen that are not drawing: efb-212/Views/Flights/ReplayView.swift, TimelineScrubBar.swift and
// TranscriptPanelView.swift, and the constants of ViewModels/ReplayViewModel.swift.

/** ReplayViewModel.availableSpeeds. */
export const REPLAY_SPEEDS = [1, 2, 4, 8] as const;

/** ReplayView.navigationTitleText: "KLAX to KSFO", or "Flight Replay" with neither airport. One airport missing leaves its side empty. */
export function replayTitle(departure: string | null, arrival: string | null): string {
  const from = departure ?? '';
  const to = arrival ?? '';
  return from === '' && to === '' ? 'Flight Replay' : `${from} to ${to}`;
}

/** Whole seconds, cut like Swift `Int(max(0, interval))`; a time that is not a number reads as zero (Swift traps on it). */
const wholeSeconds = (seconds: number): number => (Number.isFinite(seconds) ? Math.trunc(Math.max(0, seconds)) : 0);

/** TimelineScrubBar.formatTime and TranscriptPanelView.formatTime: "M:SS", or "H:MM:SS" from one hour. */
export function formatReplayTime(seconds: number): string {
  const total = wholeSeconds(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** The time left, shown at the right end of the scrub bar. */
export const remainingText = (position: number, totalDuration: number): string =>
  `-${formatReplayTime(totalDuration - position)}`;

/**
 * TimelineScrubBar.spokenTime, DateComponentsFormatter in the full style over hours, minutes and seconds with the leading zero
 * units dropped ("12 minutes, 5 seconds"); the units after the first non-zero one stay, so a whole minute is "1 minute, 0 seconds".
 */
export function spokenReplayTime(seconds: number): string {
  const total = wholeSeconds(seconds);
  const units: [number, string][] = [
    [Math.floor(total / 3600), 'hour'],
    [Math.floor((total % 3600) / 60), 'minute'],
    [total % 60, 'second'],
  ];
  const firstNonZero = units.findIndex(([value]) => value > 0);
  const first = firstNonZero === -1 ? units.length - 1 : firstNonZero; // all zero: the last unit still shows
  return units
    .slice(first)
    .map(([value, unit]) => `${value} ${unit}${value === 1 ? '' : 's'}`)
    .join(', ');
}

/** The slider's range is the flight length, never zero. */
export const scrubRange = (totalDuration: number): number => Math.max(totalDuration, 0.001);

const ABBREVIATIONS: Record<string, string> = {
  preflight: 'PRE',
  taxi: 'TXI',
  takeoff: 'T/O',
  departure: 'DEP',
  cruise: 'CRZ',
  approach: 'APR',
  landing: 'LND',
  postflight: 'PST',
};

/** TimelineScrubBar.phaseAbbreviation: the tick label of a phase marker. */
export const phaseAbbreviation = (phase: string): string =>
  ABBREVIATIONS[phase.toLowerCase()] ?? Array.from(phase).slice(0, 3).join('').toUpperCase();

/** "%.0fx". */
export const speedText = (speed: number): string => `${speed.toFixed(0)}x`;

export const audioMutedText = (speed: number): string => `Audio muted at ${speedText(speed)}`;

export interface Readout {
  text: string;
  spoken: string;
}

/** The GS, ALT and HDG readouts: whole numbers (Swift `Int()` cuts towards zero) with their spoken forms. */
export function readouts(values: { speed: number; altitude: number; heading: number }): {
  groundSpeed: Readout;
  altitude: Readout;
  heading: Readout;
} {
  const speed = Math.trunc(values.speed);
  const altitude = Math.trunc(values.altitude);
  const heading = Math.trunc(values.heading);
  return {
    groundSpeed: { text: `${speed}`, spoken: `${speed} knots` },
    altitude: { text: `${altitude}`, spoken: `${altitude} feet` },
    heading: { text: `${heading}\u00B0`, spoken: `${heading} degrees` },
  };
}

/** The panel header: "N segments", with no singular, as Swift prints it. */
export const transcriptCountText = (count: number): string => `${count} segments`;

export type ReplayPane = 'recordingActive' | 'loading' | 'error' | 'content';

/** What ReplayView shows: a running recording first, then loading, then the load error, then the replay. */
export function replayPane(status: RecordingStatus, isLoading: boolean, loadError: string | null): ReplayPane {
  if (status.kind !== 'idle') return 'recordingActive';
  if (isLoading) return 'loading';
  return loadError === null ? 'content' : 'error';
}

/** The card over the map with the segment being played, while the transcript panel is closed. */
export function collapsedTranscriptSegment<T>(
  expanded: boolean,
  index: number | null,
  segments: readonly T[],
): T | null {
  if (expanded || index === null) return null;
  return segments[index] ?? null; // an index past the list (Swift guards index < count) is nothing
}

/** Swift `String.capitalized`: the first letter of every word in capitals and the rest in lower case. */
export const capitalized = (text: string): string =>
  text
    .toLowerCase()
    .replace(/(^|[^\p{L}\p{N}'])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
