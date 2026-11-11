// Characterisation of Views/Logbook/LogbookEntryEditView.swift: the form's initial values (init), what Save writes
// (saveEntry) and the read-only summary. Swift has no test of it; the cases follow the Swift source.
import { newLogbookEntry } from '../../data/defaults';
import type { LogbookEntry } from '../../data/models';
import { logbookEditsFromForm, logbookFormFromEntry, logbookSummary, type LogbookForm } from './logbookForm';

const DATE = Date.UTC(2026, 10, 11, 9, 30);
const entry = (over: Partial<LogbookEntry> = {}): LogbookEntry =>
  newLogbookEntry({ id: 'e1', date: DATE, createdAt: DATE, ...over });
const edits = (form: LogbookForm) => {
  const result = logbookEditsFromForm(form);
  if (!result.ok) throw new Error(`expected edits, got: ${result.error}`);
  return result.edits;
};

describe('logbookFormFromEntry (the init of LogbookEntryEditView)', () => {
  it('blank fields are empty text and the counts start at the stored values', () => {
    expect(logbookFormFromEntry(entry())).toEqual({
      date: DATE,
      departureICAO: '',
      arrivalICAO: '',
      route: '',
      blockTimeHours: '0.0',
      originalDurationSeconds: 0,
      aircraftType: '',
      nightLandingCount: 0,
      dayLandingCount: 0,
      notes: '',
    });
  });

  it('shows the stored values; the block time is hours with one decimal', () => {
    const f = logbookFormFromEntry(
      entry({
        departureICAO: 'LLHZ',
        arrivalICAO: 'LLIB',
        route: 'LLHZ SDOT LLIB',
        durationSeconds: 5400,
        aircraftType: 'C172',
        nightLandingCount: 2,
        dayLandingCount: 3,
        notes: 'Smooth',
      }),
    );
    expect(f).toMatchObject({
      departureICAO: 'LLHZ',
      arrivalICAO: 'LLIB',
      route: 'LLHZ SDOT LLIB',
      blockTimeHours: '1.5',
      originalDurationSeconds: 5400,
      aircraftType: 'C172',
      nightLandingCount: 2,
      dayLandingCount: 3,
      notes: 'Smooth',
    });
  });

  it('a block time that is not a number reads as zero (JS-only guard)', () => {
    expect(logbookFormFromEntry(entry({ durationSeconds: Number.NaN })).blockTimeHours).toBe('0.0');
  });
});

describe('logbookEditsFromForm (saveEntry)', () => {
  const base = (): LogbookForm => logbookFormFromEntry(entry({ durationSeconds: 3600 }));

  it('writes the date, counts and text fields', () => {
    const e = edits({
      ...base(),
      date: DATE + 86_400_000,
      route: 'A B C',
      aircraftType: 'PA-28',
      nightLandingCount: 2,
      dayLandingCount: 4,
      notes: 'note',
    });
    expect(e).toEqual({
      date: DATE + 86_400_000,
      departureICAO: null,
      arrivalICAO: null,
      route: 'A B C',
      durationSeconds: 3600,
      aircraftType: 'PA-28',
      nightLandingCount: 2,
      dayLandingCount: 4,
      notes: 'note',
    });
  });

  it('ICAO codes are upper-cased, and empty means none', () => {
    expect(edits({ ...base(), departureICAO: 'llhz', arrivalICAO: 'llib' })).toMatchObject({
      departureICAO: 'LLHZ',
      arrivalICAO: 'LLIB',
    });
    expect(edits({ ...base(), departureICAO: '', arrivalICAO: 'kpao' })).toMatchObject({
      departureICAO: null,
      arrivalICAO: 'KPAO',
    });
    expect(edits({ ...base(), departureICAO: 'kpao', arrivalICAO: '' })).toMatchObject({
      departureICAO: 'KPAO',
      arrivalICAO: null,
    });
  });

  it('route, aircraft type and notes: empty means none, anything else is stored as typed (no trimming)', () => {
    expect(edits({ ...base(), route: '', aircraftType: '', notes: '' })).toMatchObject({
      route: null,
      aircraftType: null,
      notes: null,
    });
    expect(edits({ ...base(), route: ' x ', aircraftType: ' ', notes: '\n' })).toMatchObject({
      route: ' x ',
      aircraftType: ' ',
      notes: '\n',
    });
  });

  describe('block time', () => {
    it('an untouched field keeps the stored seconds exactly, although it shows one decimal', () => {
      const form = logbookFormFromEntry(entry({ durationSeconds: 3727 })); // 1.0353 h shows as 1.0
      expect(form.blockTimeHours).toBe('1.0');
      expect(edits(form).durationSeconds).toBe(3727);
    });

    it('a changed field is read as hours and written as seconds', () => {
      expect(edits({ ...base(), blockTimeHours: '1.5' }).durationSeconds).toBe(5400);
      expect(edits({ ...base(), blockTimeHours: '1.25' }).durationSeconds).toBe(4500);
      expect(edits({ ...base(), blockTimeHours: '0' }).durationSeconds).toBe(0);
      expect(edits({ ...base(), blockTimeHours: '10' }).durationSeconds).toBe(36_000);
    });

    it('retyping the text that was shown is still untouched (the stored seconds stay)', () => {
      const form = logbookFormFromEntry(entry({ durationSeconds: 3727 }));
      expect(edits({ ...form, blockTimeHours: '1.0' }).durationSeconds).toBe(3727);
    });

    it.each([[''], ['abc'], ['1,5'], ['1.2.3'], [' 1.5'], ['--1']])(
      'text that is not a number (%j) is an error, not a silent revert to the old value (JS-only guard)',
      (blockTimeHours) => {
        const result = logbookEditsFromForm({ ...base(), blockTimeHours });
        expect(result).toEqual({ ok: false, error: 'Enter the block time as a number of hours, like 1.5.' });
      },
    );

    it('a negative block time is an error', () => {
      expect(logbookEditsFromForm({ ...base(), blockTimeHours: '-1' })).toEqual({
        ok: false,
        error: 'The block time cannot be negative.',
      });
    });

    it('a block time too large to be a number is an error', () => {
      expect(logbookEditsFromForm({ ...base(), blockTimeHours: '1e999' }).ok).toBe(false);
    });
  });

  describe('landings (the steppers run 0 to 99)', () => {
    it.each([[0], [1], [99]])('%s is accepted', (count) => {
      expect(logbookEditsFromForm({ ...base(), dayLandingCount: count, nightLandingCount: count }).ok).toBe(true);
    });

    it.each([[-1], [100], [1.5], [Number.NaN]])('%s is an error', (count) => {
      expect(logbookEditsFromForm({ ...base(), dayLandingCount: count })).toEqual({
        ok: false,
        error: 'Landings must be whole numbers from 0 to 99.',
      });
      expect(logbookEditsFromForm({ ...base(), nightLandingCount: count }).ok).toBe(false);
    });
  });

  it('a date that is not a time is an error', () => {
    expect(logbookEditsFromForm({ ...base(), date: Number.NaN })).toEqual({ ok: false, error: 'Choose a valid date.' });
  });

  it('saving what was loaded changes nothing', () => {
    const original = entry({
      departureICAO: 'LLHZ',
      arrivalICAO: 'LLIB',
      route: 'LLHZ LLIB',
      durationSeconds: 4321,
      aircraftType: 'C172',
      nightLandingCount: 1,
      dayLandingCount: 2,
      notes: 'ok',
    });
    expect(edits(logbookFormFromEntry(original))).toEqual({
      date: original.date,
      departureICAO: 'LLHZ',
      arrivalICAO: 'LLIB',
      route: 'LLHZ LLIB',
      durationSeconds: 4321,
      aircraftType: 'C172',
      nightLandingCount: 1,
      dayLandingCount: 2,
      notes: 'ok',
    });
  });
});

describe('logbookSummary (the read-only Summary section)', () => {
  it('shows the duration in decimal hours and in hours and minutes', () => {
    expect(logbookSummary(entry({ durationSeconds: 5400 })).duration).toBe('1.5h (1h 30m)');
    expect(logbookSummary(entry({ durationSeconds: 48 })).duration).toBe('0.0h (48s)');
    expect(logbookSummary(entry({ durationSeconds: 900 })).duration).toBe('0.2h (0h 15m)'); // 0.25 h: printf takes the even digit
  });

  it('lists the airport names that exist, and whether a debrief is available', () => {
    expect(logbookSummary(entry())).toEqual({
      duration: '0.0h (0s)',
      departureName: null,
      arrivalName: null,
      hasDebrief: false,
    });
    expect(
      logbookSummary(
        entry({ departureName: 'Herzliya', arrivalName: 'Haifa', hasDebrief: true, durationSeconds: 3600 }),
      ),
    ).toEqual({ duration: '1.0h (1h 0m)', departureName: 'Herzliya', arrivalName: 'Haifa', hasDebrief: true });
  });
});
