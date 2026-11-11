import { RECOVERED_NOTE } from '../../data/models';
import { israelRoute } from '../flightLog/fixtures';
import { entry, flight, nextId } from './fixtures';
import {
  activePlanCodes,
  activePlanSpoken,
  activePlanText,
  deleteUnsignedEntry,
  entriesByFlight,
  flightRowTexts,
  flownEntryAction,
  flownItems,
  formatAbbreviatedDate,
  formatAbbreviatedDateTime,
  formatDurationDecimal,
  formatDurationHM,
  formatHourMinute,
  formatHourMinuteSecond,
  isLive,
  logRouteSpoken,
  logRouteText,
  manualEntryRowTexts,
  nowRowTexts,
  recordingText,
  totalsTexts,
} from './logic';

// Local wall-clock dates, so the expectations hold in any TZ.
const nov11 = new Date(2026, 10, 11, 16, 36).getTime();
const jan2 = new Date(2026, 0, 2, 9, 5).getTime();

// Port of efb-212Tests/ViewModelTests/FlownEntryActionTests.swift.
describe('FlownEntryAction', () => {
  it('no entry offers no action', () => {
    expect(flownEntryAction(null)).toBeNull();
  });

  it('an unsigned draft offers Sign', () => {
    expect(flownEntryAction(entry({ flightID: nextId(), isConfirmed: false }))).toBe('sign');
  });

  it('a signed entry offers Review', () => {
    expect(flownEntryAction(entry({ flightID: nextId(), isConfirmed: true }))).toBe('review');
  });

  it('a signed entry stays linked to its flight', () => {
    const flightID = nextId();
    const signed = entry({ flightID, isConfirmed: true });
    const linked = entriesByFlight([signed, entry({ flightID: null, isConfirmed: true })]);
    expect(linked.size).toBe(1);
    expect(linked.get(flightID)).toBe(signed);
  });

  it('a draft wins over a signed entry for the same flight', () => {
    const flightID = nextId();
    const signed = entry({ flightID, isConfirmed: true });
    const draft = entry({ flightID, isConfirmed: false });
    expect(entriesByFlight([signed, draft]).get(flightID)).toBe(draft);
    expect(entriesByFlight([draft, signed]).get(flightID)).toBe(draft);
  });

  it('otherwise keeps the first entry', () => {
    const flightID = nextId();
    const a = entry({ flightID, isConfirmed: true });
    const b = entry({ flightID, isConfirmed: true });
    expect(entriesByFlight([a, b]).get(flightID)).toBe(a);
    const c = entry({ flightID, isConfirmed: false });
    const d = entry({ flightID, isConfirmed: false });
    expect(entriesByFlight([c, d]).get(flightID)).toBe(c);
  });
});

describe('duration formats (LogbookViewModel)', () => {
  it('non-finite durations are dashed', () => {
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      expect(formatDurationHM(bad)).toBe('---');
      expect(formatDurationDecimal(bad)).toBe('---');
      expect(formatHourMinuteSecond(bad)).toBe('---');
      expect(formatHourMinute(bad)).toBe('---');
    }
  });

  it('formatDurationHM: hours and minutes, seconds under a minute', () => {
    expect(formatDurationHM(5400)).toBe('1h 30m');
    expect(formatDurationHM(48)).toBe('48s');
    expect(formatDurationHM(0)).toBe('0s');
    expect(formatDurationHM(-5)).toBe('0s');
    expect(formatDurationHM(59.9)).toBe('59s');
    expect(formatDurationHM(60)).toBe('0h 1m');
    expect(formatDurationHM(36000 + 119)).toBe('10h 1m');
  });

  it('formatDurationDecimal: %.1f hours, exact ties to even like printf', () => {
    expect(formatDurationDecimal(0)).toBe('0.0');
    expect(formatDurationDecimal(5400)).toBe('1.5');
    expect(formatDurationDecimal(900)).toBe('0.2'); // 0.25 h
    expect(formatDurationDecimal(2700)).toBe('0.8'); // 0.75 h
    expect(formatDurationDecimal(4500)).toBe('1.2'); // 1.25 h
    expect(formatDurationDecimal(1000)).toBe('0.3'); // 0.2777 h
    // Not ties, though seconds / 3600 * 10 lands on exactly x.5: 0.05 h is above the tie in binary, 0.15 h and 0.35 h below
    // it (values from C printf / Python '%.1f').
    expect([180, 540, 1260].map(formatDurationDecimal)).toEqual(['0.1', '0.1', '0.3']);
    expect(formatDurationDecimal(360000)).toBe('100.0');
  });

  it('formatHourMinuteSecond: Duration .time(pattern: .hourMinuteSecond)', () => {
    expect(formatHourMinuteSecond(5)).toBe('0:00:05');
    expect(formatHourMinuteSecond(3725)).toBe('1:02:05');
    expect(formatHourMinuteSecond(36000)).toBe('10:00:00');
    expect(formatHourMinuteSecond(5.4)).toBe('0:00:05');
    expect(formatHourMinuteSecond(5.5)).toBe('0:00:06');
    expect(formatHourMinuteSecond(4.5)).toBe('0:00:04');
  });

  it('formatHourMinute: Duration .time(pattern: .hourMinute), seconds rounded to even', () => {
    expect(formatHourMinute(0)).toBe('0:00');
    expect(formatHourMinute(65 * 60)).toBe('1:05');
    expect(formatHourMinute(90)).toBe('0:02');
    expect(formatHourMinute(150)).toBe('0:02');
    expect(formatHourMinute(29)).toBe('0:00');
  });
});

describe('dates', () => {
  it('abbreviated date, with and without the shortened time', () => {
    expect(formatAbbreviatedDate(nov11)).toBe('Nov 11, 2026');
    expect(formatAbbreviatedDateTime(nov11)).toBe('Nov 11, 2026 at 4:36 PM');
    expect(formatAbbreviatedDateTime(jan2)).toBe('Jan 2, 2026 at 9:05 AM');
    expect(formatAbbreviatedDateTime(new Date(2026, 0, 2, 0, 0).getTime())).toBe('Jan 2, 2026 at 12:00 AM');
    expect(formatAbbreviatedDateTime(new Date(2026, 0, 2, 12, 0).getTime())).toBe('Jan 2, 2026 at 12:00 PM');
  });
});

describe('route texts', () => {
  it('logRouteText and logRouteSpoken fill unknown idents', () => {
    expect(logRouteText('KSQL', 'KOAK')).toBe('KSQL \u25B8 KOAK');
    expect(logRouteText(null, null)).toBe('--- \u25B8 ---');
    expect(logRouteSpoken('KSQL', null)).toBe('KSQL to unknown');
  });

  it('active plan text joins every route point', () => {
    expect(activePlanText(['LLHZ', 'ZOMET', 'LLIB'])).toBe('LLHZ \u25B8 ZOMET \u25B8 LLIB');
    expect(activePlanSpoken(['LLHZ', 'LLIB'])).toBe('LLHZ to LLIB');
    expect(activePlanText(null)).toBeNull();
    expect(activePlanSpoken(null)).toBeNull();
  });

  it('an empty route has no active plan text', () => {
    expect(activePlanText([])).toBeNull();
    expect(activePlanSpoken([])).toBeNull();
  });

  const noNav = {
    directTo: null,
    activeFlightPlan: false,
    activeRoute: null,
    planDeparture: null,
    planDestination: null,
  };

  it('active plan codes: the route legs, else departure and destination of an active plan', () => {
    expect(activePlanCodes({ ...noNav, activeFlightPlan: true, activeRoute: israelRoute })).toEqual([
      'LLHZ',
      'MIDAA',
      'BAZRA',
      'NATAN',
      'LLIB',
    ]);
    // Swift reads appState.activeRoute without checking activeFlightPlan.
    expect(activePlanCodes({ ...noNav, activeRoute: israelRoute })?.[0]).toBe('LLHZ');
    expect(
      activePlanCodes({ ...noNav, activeFlightPlan: true, planDeparture: 'KSQL', planDestination: 'KOAK' }),
    ).toEqual(['KSQL', 'KOAK']);
    expect(activePlanCodes({ ...noNav, planDeparture: 'KSQL', planDestination: 'KOAK' })).toBeNull();
    expect(activePlanCodes({ ...noNav, activeFlightPlan: true, planDeparture: 'KSQL' })).toBeNull();
    expect(activePlanCodes({ ...noNav, activeFlightPlan: true, activeRoute: { ...israelRoute, legs: [] } })).toBeNull();
    expect(activePlanCodes(noNav)).toBeNull();
  });
});

describe('Now', () => {
  it('is live while recording or navigating', () => {
    expect(isLive({ kind: 'idle' }, false)).toBe(false);
    expect(isLive({ kind: 'idle' }, true)).toBe(true);
    expect(isLive({ kind: 'paused' }, false)).toBe(true);
  });

  it('recording text per status', () => {
    expect(recordingText({ kind: 'idle' }, 5)).toBeNull();
    expect(recordingText({ kind: 'countdown', remaining: 3 }, 0)).toBe('REC in 3 s');
    expect(recordingText({ kind: 'recording' }, 5)).toBe('REC 0:00:05');
    expect(recordingText({ kind: 'paused' }, 5)).toBe('REC paused');
    expect(recordingText({ kind: 'stopping' }, 5)).toBe('REC stopping');
  });

  const base = {
    directToIcao: null,
    planCodes: null,
    recording: { kind: 'recording' } as const,
    elapsedSeconds: 5,
    nextIdent: null,
    eteSeconds: null,
  };

  it('a recording without navigation is "Flight"', () => {
    const now = nowRowTexts(base);
    expect(now.routeText).toBe('Flight');
    expect(now.recordingText).toBe('REC 0:00:05');
    expect(now.nextText).toBeNull();
    expect(now.accessibilityLabel).toBe('Now, Flight, REC 0:00:05');
  });

  it('the plan route, with the next waypoint and its ETE', () => {
    const now = nowRowTexts({ ...base, planCodes: ['LLHZ', 'LLIB'], nextIdent: 'LLIB', eteSeconds: 65 * 60 });
    expect(now.routeText).toBe('LLHZ \u25B8 LLIB');
    expect(now.nextText).toBe('Next LLIB');
    expect(now.eteText).toBe('1:05');
    expect(now.accessibilityLabel).toBe('Now, LLHZ to LLIB, REC 0:00:05, next LLIB, time to next 1h 5m');
  });

  it('a Direct-To wins over the plan; a stale fix hides the ETE', () => {
    const now = nowRowTexts({
      ...base,
      recording: { kind: 'idle' },
      directToIcao: 'KOAK',
      planCodes: ['KSQL', 'KSFO'],
      nextIdent: 'KOAK',
      eteSeconds: null,
    });
    expect(now.routeText).toBe('Direct KOAK');
    expect(now.recordingText).toBeNull();
    expect(now.eteText).toBe('ETE ---');
    expect(now.accessibilityLabel).toBe('Now, Direct KOAK, next KOAK, time to next unavailable');
  });

  it('an empty plan route falls back to "Flight", never a blank route', () => {
    const now = nowRowTexts({ ...base, planCodes: [] });
    expect(now.routeText).toBe('Flight');
    expect(now.accessibilityLabel).toBe('Now, Flight, REC 0:00:05');
  });

  it('a non-finite ETE or elapsed time is dashed, never Infinity or NaN', () => {
    const now = nowRowTexts({ ...base, elapsedSeconds: Number.NaN, nextIdent: 'LLIB', eteSeconds: Infinity });
    expect(now.eteText).toBe('ETE ---');
    expect(now.recordingText).toBe('REC ---');
    expect(now.accessibilityLabel).toBe('Now, Flight, REC ---, next LLIB, time to next unavailable');
  });
});

describe('Flown', () => {
  it('lists flights with their entries and standalone entries, newest first', () => {
    const old = flight({ startDate: 1000 });
    const recent = flight({ startDate: 3000 });
    const draft = entry({ flightID: recent.id, date: 3000 });
    const manual = entry({ date: 2000 });
    const orphan = entry({ flightID: 'deleted-recording', date: 4000 });
    const items = flownItems([old, recent], [draft, manual, orphan]);
    expect(items.map((i) => (i.kind === 'flight' ? i.flight.id : i.entry.id))).toEqual([
      orphan.id,
      recent.id,
      manual.id,
      old.id,
    ]);
    expect(items[1]).toEqual({ kind: 'flight', flight: recent, entry: draft });
    expect(items[3]).toEqual({ kind: 'flight', flight: old, entry: null });
  });

  it('keeps the newest of several signed entries for one flight (entries sorted by date first)', () => {
    const f = flight({ startDate: 1 });
    const older = entry({ flightID: f.id, date: 1, isConfirmed: true });
    const newer = entry({ flightID: f.id, date: 2, isConfirmed: true });
    const items = flownItems([f], [older, newer]);
    expect(items).toEqual([{ kind: 'flight', flight: f, entry: newer }]);
  });

  it('is empty without flights or entries', () => {
    expect(flownItems([], [])).toEqual([]);
  });

  it('flight row texts: sign action for a draft', () => {
    const f = flight({ startDate: nov11, departureICAO: 'KSQL', arrivalICAO: 'KOAK', durationSeconds: 2700 });
    const texts = flightRowTexts(f, entry({ flightID: f.id }));
    expect(texts).toEqual({
      dateText: 'Nov 11, 2026 at 4:36 PM',
      routeText: 'KSQL \u25B8 KOAK',
      blockTime: '0h 45m',
      warning: null,
      action: 'sign',
      accessibilityLabel: 'Flight, Nov 11, 2026 at 4:36 PM, KSQL to KOAK, block time 0h 45m, Logbook draft, not signed',
      actionLabel: 'Sign logbook draft, KSQL to KOAK',
      actionTestID: 'log-sign-draft',
    });
  });

  it('flight row texts: review action for a signed entry, health caution', () => {
    const f = flight({
      startDate: nov11,
      departureICAO: 'KSQL',
      durationSeconds: 30,
      notes: RECOVERED_NOTE,
    });
    const texts = flightRowTexts(f, entry({ flightID: f.id, isConfirmed: true }));
    expect(texts.warning).toBe('Recovered');
    expect(texts.action).toBe('review');
    expect(texts.actionLabel).toBe('Logbook entry, KSQL to unknown');
    expect(texts.actionTestID).toBe('log-open-entry');
    expect(texts.accessibilityLabel).toBe(
      'Flight, Nov 11, 2026 at 4:36 PM, KSQL to unknown, block time 30s, Caution, Recovered, Logbook entry signed',
    );
  });

  it('flight row texts: no entry, no action', () => {
    const texts = flightRowTexts(flight({ startDate: nov11 }), null);
    expect(texts.action).toBeNull();
    expect(texts.accessibilityLabel).toBe('Flight, Nov 11, 2026 at 4:36 PM, unknown to unknown, block time 0s');
  });

  it('manual entry row texts', () => {
    const draft = manualEntryRowTexts(
      entry({ date: jan2, departureICAO: 'LLHZ', arrivalICAO: 'LLIB', durationSeconds: 3600 }),
    );
    expect(draft).toEqual({
      dateText: 'Jan 2, 2026',
      routeText: 'LLHZ \u25B8 LLIB',
      duration: '1h 0m',
      aircraftText: 'Aircraft not set',
      signed: false,
      accessibilityLabel: 'Logbook entry, Jan 2, 2026, LLHZ to LLIB, time 1h 0m, aircraft not set, draft, not signed',
      accessibilityHint: 'Opens the entry to edit and sign',
    });
    const signed = manualEntryRowTexts(entry({ date: jan2, aircraftType: 'C172', isConfirmed: true }));
    expect(signed.aircraftText).toBe('C172');
    expect(signed.accessibilityLabel).toBe('Logbook entry, Jan 2, 2026, unknown to unknown, time 0s, C172, signed');
    expect(signed.accessibilityHint).toBe('Opens the signed entry');
  });
});

describe('deleting entries', () => {
  it('deletes an unsigned entry and never a signed one (signed entries are locked)', () => {
    const remove = jest.fn();
    const draft = entry({ isConfirmed: false });
    deleteUnsignedEntry(draft, remove);
    expect(remove).toHaveBeenCalledWith(draft.id);
    remove.mockClear();
    deleteUnsignedEntry(entry({ isConfirmed: true }), remove);
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('Totals', () => {
  it('skips a non-finite duration instead of dashing the whole total', () => {
    const t = totalsTexts([
      entry({ durationSeconds: 3600 }),
      entry({ durationSeconds: Number.NaN }),
      entry({ durationSeconds: Infinity }),
    ]);
    expect(t.flightsText).toBe('3 flights');
    expect(t.timeText).toBe('1.0 h');
  });

  it('no entries', () => {
    expect(totalsTexts([])).toEqual({
      flightsText: '0 flights',
      timeText: '0.0 h',
      draftsText: null,
      accessibilityLabel: 'Logbook total, 0 flights, 0.0 hours',
    });
  });

  it('one signed flight', () => {
    const t = totalsTexts([entry({ durationSeconds: 5400, isConfirmed: true })]);
    expect(t.flightsText).toBe('1 flight');
    expect(t.timeText).toBe('1.5 h');
    expect(t.draftsText).toBeNull();
  });

  it('drafts to sign, singular and plural', () => {
    expect(totalsTexts([entry({ durationSeconds: 1800 })]).draftsText).toBe('1 draft to sign');
    const t = totalsTexts([
      entry({ durationSeconds: 1800 }),
      entry({ durationSeconds: 1800 }),
      entry({ isConfirmed: true }),
    ]);
    expect(t.flightsText).toBe('3 flights');
    expect(t.timeText).toBe('1.0 h');
    expect(t.draftsText).toBe('2 drafts to sign');
    expect(t.accessibilityLabel).toBe('Logbook total, 3 flights, 1.0 hours, 2 drafts to sign');
  });
});
