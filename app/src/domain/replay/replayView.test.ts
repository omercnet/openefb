// The rules of the replay screen that are not drawing: efb-212/Views/Flights/ReplayView.swift, TimelineScrubBar.swift and
// TranscriptPanelView.swift, and the constants of ViewModels/ReplayViewModel.swift. Swift has no tests for any of them; the
// cases follow the source.
import {
  REPLAY_SPEEDS,
  audioMutedText,
  capitalized,
  collapsedTranscriptSegment,
  formatReplayTime,
  phaseAbbreviation,
  readouts,
  remainingText,
  replayPane,
  replayTitle,
  scrubRange,
  speedText,
  spokenReplayTime,
  transcriptCountText,
} from './replayView';

describe('replayTitle', () => {
  it('is "Flight Replay" without either airport', () => {
    expect(replayTitle(null, null)).toBe('Flight Replay');
    expect(replayTitle('', '')).toBe('Flight Replay');
  });

  it('names the two airports', () => {
    expect(replayTitle('LLHZ', 'LLNV')).toBe('LLHZ to LLNV');
  });

  it('with one airport missing keeps the other side empty, as Swift builds the string', () => {
    expect(replayTitle('LLHZ', null)).toBe('LLHZ to ');
    expect(replayTitle(null, 'LLNV')).toBe(' to LLNV');
  });
});

describe('formatReplayTime', () => {
  it.each([
    [0, '0:00'],
    [5, '0:05'],
    [65, '1:05'],
    [599.9, '9:59'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3725, '1:02:05'],
    [36_000, '10:00:00'],
  ])('%d s is %s', (seconds, text) => {
    expect(formatReplayTime(seconds)).toBe(text);
  });

  it('a negative time reads as zero', () => {
    expect(formatReplayTime(-4)).toBe('0:00');
  });

  it.each([NaN, Infinity, -Infinity])('%s reads as zero (JS-only guard: Swift Int() traps on it)', (seconds) => {
    expect(formatReplayTime(seconds)).toBe('0:00');
  });
});

describe('remainingText', () => {
  it('is the time left with a leading minus', () => {
    expect(remainingText(65, 725)).toBe('-11:00');
  });

  it('never goes below zero when the position is past the end', () => {
    expect(remainingText(730, 725)).toBe('-0:00');
  });
});

describe('spokenReplayTime', () => {
  it.each([
    [0, '0 seconds'],
    [1, '1 second'],
    [5, '5 seconds'],
    [60, '1 minute, 0 seconds'],
    [725, '12 minutes, 5 seconds'],
    [3600, '1 hour, 0 minutes, 0 seconds'],
    [3725, '1 hour, 2 minutes, 5 seconds'],
    [7261.9, '2 hours, 1 minute, 1 second'],
  ])('%d s is "%s"', (seconds, text) => {
    expect(spokenReplayTime(seconds)).toBe(text);
  });

  it('a negative or invalid time is zero seconds', () => {
    expect(spokenReplayTime(-3)).toBe('0 seconds');
    expect(spokenReplayTime(NaN)).toBe('0 seconds');
  });
});

describe('scrubRange', () => {
  it('is the flight length, and never zero (the slider needs a range)', () => {
    expect(scrubRange(725)).toBe(725);
    expect(scrubRange(0)).toBe(0.001);
  });
});

describe('phaseAbbreviation', () => {
  it.each([
    ['preflight', 'PRE'],
    ['taxi', 'TXI'],
    ['takeoff', 'T/O'],
    ['departure', 'DEP'],
    ['cruise', 'CRZ'],
    ['approach', 'APR'],
    ['landing', 'LND'],
    ['postflight', 'PST'],
  ])('%s is %s', (phase, abbreviation) => {
    expect(phaseAbbreviation(phase)).toBe(abbreviation);
  });

  it('ignores case', () => {
    expect(phaseAbbreviation('CRUISE')).toBe('CRZ');
    expect(phaseAbbreviation('TakeOff')).toBe('T/O');
  });

  it('an unknown phase is its first three letters in capitals', () => {
    expect(phaseAbbreviation('holding')).toBe('HOL');
    expect(phaseAbbreviation('go')).toBe('GO');
    expect(phaseAbbreviation('')).toBe('');
  });
});

describe('speeds', () => {
  it('are 1x, 2x, 4x and 8x', () => {
    expect(REPLAY_SPEEDS).toEqual([1, 2, 4, 8]);
  });

  it('read as a whole number with an x', () => {
    expect(REPLAY_SPEEDS.map(speedText)).toEqual(['1x', '2x', '4x', '8x']);
  });

  it('are rounded to a whole number, as "%.0f" does (the picker only offers whole ones)', () => {
    expect(speedText(2.4)).toBe('2x');
  });

  it('say when the audio is muted', () => {
    expect(audioMutedText(4)).toBe('Audio muted at 4x');
    expect(audioMutedText(8)).toBe('Audio muted at 8x');
  });
});

describe('readouts', () => {
  it('shows ground speed, altitude and heading as whole numbers with spoken forms', () => {
    expect(readouts({ speed: 102, altitude: 2450, heading: 274 })).toEqual({
      groundSpeed: { text: '102', spoken: '102 knots' },
      altitude: { text: '2450', spoken: '2450 feet' },
      heading: { text: '274\u00B0', spoken: '274 degrees' },
    });
  });

  it('cuts the fraction off, as Swift Int() does, towards zero', () => {
    const r = readouts({ speed: 101.9, altitude: -12.7, heading: 359.9 });
    expect(r.groundSpeed.text).toBe('101');
    expect(r.altitude.text).toBe('-12');
    expect(r.heading.text).toBe('359\u00B0');
  });
});

describe('transcriptCountText', () => {
  it('counts segments, with no singular, as Swift prints it', () => {
    expect(transcriptCountText(0)).toBe('0 segments');
    expect(transcriptCountText(1)).toBe('1 segments');
    expect(transcriptCountText(12)).toBe('12 segments');
  });
});

describe('replayPane', () => {
  const idle = { kind: 'idle' as const };

  it.each([
    [{ kind: 'recording' as const }],
    [{ kind: 'countdown' as const, remaining: 2 }],
    [{ kind: 'paused' as const }],
    [{ kind: 'stopping' as const }],
  ])('a recording in progress (%j) hides everything else', (status) => {
    expect(replayPane(status, false, null)).toBe('recordingActive');
    expect(replayPane(status, true, 'x')).toBe('recordingActive');
  });

  it('loading comes before an error, as in Swift', () => {
    expect(replayPane(idle, true, 'Track data could not be read')).toBe('loading');
  });

  it('shows the error, then the replay', () => {
    expect(replayPane(idle, false, 'Track data could not be read')).toBe('error');
    expect(replayPane(idle, false, null)).toBe('content');
  });
});

describe('collapsedTranscriptSegment (the card over the map while the panel is closed)', () => {
  const segments = [{ text: 'a' }, { text: 'b' }];

  it('is the segment being played', () => {
    expect(collapsedTranscriptSegment(false, 1, segments)).toBe(segments[1]);
  });

  it('is nothing while the panel is open', () => {
    expect(collapsedTranscriptSegment(true, 1, segments)).toBeNull();
  });

  it('is nothing between segments', () => {
    expect(collapsedTranscriptSegment(false, null, segments)).toBeNull();
  });

  it('is nothing for an index past the list (Swift guards with index < count)', () => {
    expect(collapsedTranscriptSegment(false, 2, segments)).toBeNull();
  });
});

describe('capitalized (the phase badge under a transcript line: Swift String.capitalized)', () => {
  it.each([
    ['taxi', 'Taxi'],
    ['CRUISE', 'Cruise'],
    ['go around', 'Go Around'],
    ['t/o', 'T/O'],
    ["don't", "Don't"],
    ['', ''],
  ])('%s is %s', (text, expected) => {
    expect(capitalized(text)).toBe(expected);
  });
});
