// The rules of efb-212/Views/Flights/FlightDetailView.swift that are not drawing. The first two cases are the ones of
// efb-212Tests/ServiceTests/MapGPSRecordingFixesTests.swift's DiscardAndDebriefTests (the third, the discarded notice, is U8a's);
// the rest follow the Swift source.
import type { FlightRecord } from '../../data/models';
import { RECOVERED_NOTE, TRACK_UNREADABLE_NOTE } from '../../data/models';
import {
  aiDebriefState,
  buildMetadata,
  debriefIneligibleReason,
  flightDetailSections,
  flightInfo,
  recordingStats,
  replaySection,
} from './flightDetail';

const flight: Pick<
  FlightRecord,
  | 'startDate'
  | 'departureICAO'
  | 'arrivalICAO'
  | 'departureName'
  | 'arrivalName'
  | 'durationSeconds'
  | 'notes'
  | 'trackPointCount'
  | 'transcriptSegmentCount'
  | 'audioQuality'
> = {
  startDate: Date.UTC(2026, 10, 11, 18, 30),
  departureICAO: 'LLHA',
  arrivalICAO: 'LLNV',
  departureName: 'Haifa',
  arrivalName: 'Nevatim',
  durationSeconds: 5430,
  notes: null,
  trackPointCount: 5430,
  transcriptSegmentCount: 12,
  audioQuality: 'standard',
};

describe('debriefIneligibleReason', () => {
  const reason = 'Too short for a debrief: this flight is under a minute and has no transcript.';

  it('subMinuteWithoutTranscriptIsNotEligible', () => {
    expect(debriefIneligibleReason(48, 0)).toBe(reason);
  });

  it('transcriptOrOneMinuteMakesItEligible', () => {
    expect(debriefIneligibleReason(48, 3)).toBeNull();
    expect(debriefIneligibleReason(60, 0)).toBeNull();
    expect(debriefIneligibleReason(59.9, 0)).not.toBeNull();
  });

  it('a flight with no time at all and no transcript is not eligible', () => {
    expect(debriefIneligibleReason(0, 0)).toBe(reason);
  });
});

describe('flightInfo', () => {
  const format = { locale: 'en-US', timeZone: 'UTC' };

  it('is the date, the two airports with their names, and the duration', () => {
    expect(flightInfo(flight, format)).toEqual({
      date: 'Nov 11, 2026, 6:30 PM',
      from: { code: 'LLHA', name: 'Haifa' },
      to: { code: 'LLNV', name: 'Nevatim' },
      duration: '1h 30m',
      warning: null,
    });
  });

  it('shows --- for an airport that was not found, and no name line', () => {
    const info = flightInfo(
      { ...flight, departureICAO: null, departureName: null, arrivalICAO: null, arrivalName: null },
      format,
    );
    expect(info.from).toEqual({ code: '---', name: null });
    expect(info.to).toEqual({ code: '---', name: null });
  });

  it('keeps a name that is empty, as Swift prints any non-nil name', () => {
    expect(flightInfo({ ...flight, departureName: '' }, format).from.name).toBe('');
  });

  it('shows the note of a recovered flight, or one whose track could not be read, as a caution', () => {
    const recovered = `${RECOVERED_NOTE} Check the times.`;
    expect(flightInfo({ ...flight, notes: recovered }, format).warning).toBe(recovered);
    const damaged = `${TRACK_UNREADABLE_NOTE} (disk error)`;
    expect(flightInfo({ ...flight, notes: damaged }, format).warning).toBe(damaged);
  });

  it('does not show an ordinary note: only a health warning is a caution', () => {
    expect(flightInfo({ ...flight, notes: 'Pattern work, wind 270 at 12' }, format).warning).toBeNull();
  });
});

describe('recordingStats', () => {
  it('lists the track points, the transcript segments and the audio quality', () => {
    expect(recordingStats(flight)).toEqual([
      ['Track Points', '5430'],
      ['Transcript Segments', '12'],
      ['Audio Quality', 'Standard'],
    ]);
  });
});

describe('replaySection', () => {
  it('is disabled while a recording runs, whatever the track', () => {
    expect(replaySection({ kind: 'recording' }, 100)).toEqual({
      kind: 'recordingActive',
      text: 'End the recording to replay a flight',
    });
    expect(replaySection({ kind: 'countdown', remaining: 2 }, 0).kind).toBe('recordingActive');
  });

  it('offers the replay for a flight with track points', () => {
    expect(replaySection({ kind: 'idle' }, 1)).toEqual({ kind: 'available' });
  });

  it('says there is nothing to replay for a flight with no track points', () => {
    expect(replaySection({ kind: 'idle' }, 0)).toEqual({
      kind: 'noTrack',
      text: 'No track data available for replay',
    });
  });
});

describe('buildMetadata', () => {
  it('is what the debrief prompt knows about the flight (Swift leaves the aircraft and pilot nil)', () => {
    expect(buildMetadata(flight)).toEqual({
      aircraftType: null,
      pilotName: null,
      departureICAO: 'LLHA',
      arrivalICAO: 'LLNV',
      date: flight.startDate,
      durationSeconds: 5430,
    });
  });
});

describe('aiDebriefState', () => {
  const eligible = { hasDebrief: false, durationSeconds: 600, transcriptSegmentCount: 4, databaseOpened: true };

  it('is checking until the model says whether it can run', () => {
    expect(aiDebriefState({ kind: 'unknown' }, eligible)).toEqual({ kind: 'checking' });
  });

  it('says why the model cannot run, with a way to Settings when the reason says it is not enabled', () => {
    expect(
      aiDebriefState({ kind: 'unavailable', reason: 'Apple Intelligence is not enabled in Settings.' }, eligible),
    ).toEqual({
      kind: 'unavailable',
      reason: 'Apple Intelligence is not enabled in Settings.',
      canOpenSettings: true,
    });
    expect(aiDebriefState({ kind: 'unavailable', reason: 'This device is not eligible.' }, eligible)).toEqual({
      kind: 'unavailable',
      reason: 'This device is not eligible.',
      canOpenSettings: false,
    });
  });

  it('offers to generate a debrief for an eligible flight, and to view one that exists', () => {
    expect(aiDebriefState({ kind: 'available' }, eligible)).toEqual({
      kind: 'open',
      title: 'Generate Debrief',
      hasDebrief: false,
    });
    expect(aiDebriefState({ kind: 'available' }, { ...eligible, hasDebrief: true })).toEqual({
      kind: 'open',
      title: 'View Debrief',
      hasDebrief: true,
    });
  });

  it('gives the reason when the flight is too short and has no debrief yet', () => {
    const short = { ...eligible, durationSeconds: 48, transcriptSegmentCount: 0 };
    expect(aiDebriefState({ kind: 'available' }, short)).toEqual({
      kind: 'ineligible',
      reason: 'Too short for a debrief: this flight is under a minute and has no transcript.',
    });
  });

  it('still lets a short flight that already has a debrief open it', () => {
    const short = { ...eligible, hasDebrief: true, durationSeconds: 48, transcriptSegmentCount: 0 };
    expect(aiDebriefState({ kind: 'available' }, short).kind).toBe('open');
  });

  it('says the recording database could not be opened, after the eligibility reason', () => {
    expect(aiDebriefState({ kind: 'available' }, { ...eligible, databaseOpened: false })).toEqual({
      kind: 'noDatabase',
    });
    const short = { ...eligible, databaseOpened: false, durationSeconds: 48, transcriptSegmentCount: 0 };
    expect(aiDebriefState({ kind: 'available' }, short).kind).toBe('ineligible');
  });
});

describe('flightDetailSections', () => {
  const everything = { platform: 'ios', hasCvfr: true, hasDebriefEngine: true };

  it('are the info, the recording data, the replay, the CVFR debrief and the AI debrief, in that order', () => {
    expect(flightDetailSections(everything)).toEqual(['info', 'stats', 'replay', 'cvfr', 'aiDebrief']);
  });

  it('leave the AI debrief out on Android (owner decision Q8): the section is not shown at all', () => {
    expect(flightDetailSections({ ...everything, platform: 'android' })).toEqual(['info', 'stats', 'replay', 'cvfr']);
  });

  it('keep it on iOS and on the web preview', () => {
    expect(flightDetailSections({ ...everything, platform: 'web' })).toContain('aiDebrief');
    expect(flightDetailSections(everything)).toContain('aiDebrief');
  });

  it('leave the AI debrief out when the app has no debrief engine (the adapter is not there yet)', () => {
    expect(flightDetailSections({ ...everything, hasDebriefEngine: false })).not.toContain('aiDebrief');
  });

  it('show the CVFR section only for a flight that has one, independent of the AI debrief', () => {
    expect(flightDetailSections({ ...everything, hasCvfr: false })).toEqual(['info', 'stats', 'replay', 'aiDebrief']);
    expect(flightDetailSections({ platform: 'android', hasCvfr: true, hasDebriefEngine: false })).toContain('cvfr');
  });
});
