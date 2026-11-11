// Ports of DataTests/LogbookEntryTests (the 9 view-model cases; D2 ported `defaultValues`) and the pure cases of
// ViewModelTests/LogbookViewModelTests. The cases that need stored data are in logbookData.test.ts.
import {
  confirmEntry,
  createFromRecording,
  createManualEntry,
  formatDurationDecimal,
  formatDurationHM,
  type CreateFromRecordingArgs,
} from './logbook';

const flightID = '00000000-0000-4000-8000-000000000001';
const aircraftID = '00000000-0000-4000-8000-000000000002';
const pilotID = '00000000-0000-4000-8000-000000000003';

describe('LogbookEntry Tests', () => {
  describe('duration formatting: decimal hours', () => {
    it('formatDurationDecimal1Hour', () => {
      expect(formatDurationDecimal(3600)).toBe('1.0');
    });
    it('formatDurationDecimal1Point5', () => {
      expect(formatDurationDecimal(5400)).toBe('1.5');
    });
    it('formatDurationDecimalZero', () => {
      expect(formatDurationDecimal(0)).toBe('0.0');
    });
  });

  describe('duration formatting: hours and minutes', () => {
    it('formatDurationHM1Hour30Min', () => {
      expect(formatDurationHM(5400)).toBe('1h 30m');
    });
    it('formatDurationHMZero', () => {
      expect(formatDurationHM(0)).toBe('0s');
    });
    it('formatDurationHM2Hours', () => {
      expect(formatDurationHM(7200)).toBe('2h 0m');
    });
  });

  describe('create from recording (field mapping)', () => {
    const summary = {
      flightID,
      startDate: 1_700_000_000_000,
      endDate: 1_700_003_600_000, // +1 hour
    };

    it('createFromRecordingSetsFields', () => {
      const entry = createFromRecording(summary, {
        departureICAO: 'KPAO',
        departureName: 'Palo Alto',
        arrivalICAO: 'KSQL',
        arrivalName: 'San Carlos',
        aircraftProfileID: aircraftID,
        aircraftType: 'C172',
        pilotProfileID: pilotID,
      });
      expect(entry.flightID).toBe(flightID);
      expect(entry.date).toBe(summary.startDate);
      expect(entry.departureICAO).toBe('KPAO');
      expect(entry.departureName).toBe('Palo Alto');
      expect(entry.arrivalICAO).toBe('KSQL');
      expect(entry.arrivalName).toBe('San Carlos');
      expect(entry.durationSeconds).toBe(3600);
      expect(entry.aircraftProfileID).toBe(aircraftID);
      expect(entry.aircraftType).toBe('C172');
      expect(entry.pilotProfileID).toBe(pilotID);
      expect(entry.isConfirmed).toBe(false);
    });

    it('createFromRecordingWithNilAirports', () => {
      const nothing: CreateFromRecordingArgs = {
        departureICAO: null,
        departureName: null,
        arrivalICAO: null,
        arrivalName: null,
        aircraftProfileID: null,
        aircraftType: null,
        pilotProfileID: null,
      };
      const entry = createFromRecording({ ...summary, endDate: summary.startDate + 1_800_000 }, nothing);
      expect(entry.departureICAO).toBeNull();
      expect(entry.arrivalICAO).toBeNull();
      expect(entry.aircraftProfileID).toBeNull();
      expect(entry.aircraftType).toBeNull();
    });

    it('a draft starts with the model defaults for everything the recording does not know', () => {
      const entry = createFromRecording(summary, {
        departureICAO: null,
        departureName: null,
        arrivalICAO: null,
        arrivalName: null,
        aircraftProfileID: null,
        aircraftType: null,
        pilotProfileID: null,
      });
      expect(entry).toMatchObject({
        route: null,
        nightLandingCount: 0,
        dayLandingCount: 0,
        notes: null,
        hasDebrief: false,
        isConfirmed: false,
      });
    });

    it('takes the id and the creation time from the factory, so a test can fix them', () => {
      const entry = createFromRecording(
        summary,
        {
          departureICAO: null,
          departureName: null,
          arrivalICAO: null,
          arrivalName: null,
          aircraftProfileID: null,
          aircraftType: null,
          pilotProfileID: null,
        },
        { newId: () => 'fixed-id', now: () => 42 },
      );
      expect(entry.id).toBe('fixed-id');
      expect(entry.createdAt).toBe(42);
    });
  });

  describe('confirm entry', () => {
    it('confirmedEntryIsLocked', () => {
      const entry = createManualEntry({ now: () => 1 });
      expect(entry.isConfirmed).toBe(false);
      const confirmed = confirmEntry(entry);
      expect(confirmed.isConfirmed).toBe(true);
    });

    it('confirming returns a new record and leaves the original alone', () => {
      const entry = createManualEntry({ now: () => 1 });
      const confirmed = confirmEntry(entry);
      expect(confirmed).not.toBe(entry);
      expect(entry.isConfirmed).toBe(false);
      expect(confirmed).toEqual({ ...entry, isConfirmed: true });
    });
  });
});

describe('LogbookViewModel Tests', () => {
  it('manualEntryIsUnconfirmedHasNoFlightIDAndIsDatedNow', () => {
    const entry = createManualEntry({ now: () => 1_700_000_000_000 });
    expect(entry.flightID).toBeNull();
    expect(entry.isConfirmed).toBe(false);
    expect(entry.date).toBe(1_700_000_000_000);
  });

  it('decimalHoursRoundHalfUpAtOneDecimal', () => {
    // The Swift name says half up; String(format: "%.1f") rounds an exact tie to the even digit (0.75 h is 0.8).
    expect(formatDurationDecimal(2700)).toBe('0.8'); // 0.75 h
    expect(formatDurationDecimal(2520)).toBe('0.7'); // 0.70 h
    expect(formatDurationDecimal(36_000)).toBe('10.0');
  });

  it('decimal hours follow printf on exact ties (a 15 minute flight is 0.2 h, as in Swift)', () => {
    expect(formatDurationDecimal(900)).toBe('0.2');
    expect(formatDurationDecimal(4500)).toBe('1.2');
  });

  it('hoursMinutesTruncateSecondsAndRollOverAtSixtyMinutes', () => {
    expect(formatDurationHM(3599)).toBe('0h 59m'); // 59 min 59 s is not an hour
    expect(formatDurationHM(3600)).toBe('1h 0m');
    expect(formatDurationHM(150)).toBe('0h 2m');
    expect(formatDurationHM(90_061)).toBe('25h 1m'); // no day rollover
  });

  it('subMinuteFlightShowsSecondsNotZeroHours', () => {
    expect(formatDurationHM(48)).toBe('48s'); // the 48 s flight from the review
    expect(formatDurationHM(59.9)).toBe('59s'); // truncates, never rounds up to a minute
    expect(formatDurationHM(60)).toBe('0h 1m');
    expect(formatDurationHM(-5)).toBe('0s');
  });

  it('a duration that is not a number reads as zero (JS-only guard: Int(NaN) traps in Swift)', () => {
    expect(formatDurationHM(Number.NaN)).toBe('0s');
    expect(formatDurationDecimal(Number.NaN)).toBe('0.0');
  });
});
