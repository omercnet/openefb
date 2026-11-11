// Characterisation of PilotEditView (load and save), PilotProfileView (rows, night landings, display names) and
// PilotProfileViewModel (computeCurrency, addNightLandings). Swift has no test of these; the cases follow the Swift source.
import { newPilotProfile } from '../../data/defaults';
import { CERTIFICATE_TYPES, MEDICAL_CLASSES, type PilotProfile } from '../../data/models';
import {
  addNightLanding,
  CERTIFICATE_TYPE_NAMES,
  computePilotCurrency,
  emptyPilotForm,
  landingCountText,
  MEDICAL_CLASS_NAMES,
  NIGHT_LANDING_STEPPER,
  pilotFieldsFromForm,
  pilotFormFromProfile,
  pilotInfoRows,
  pilotRowSubtitle,
  pilotRowTitle,
  recentNightLandings,
  type PilotForm,
} from './pilot';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 11, 9, 30);
const pilot = (over: Partial<PilotProfile> = {}): PilotProfile => newPilotProfile({ id: 'p1', createdAt: 1, ...over });
const form = (over: Partial<PilotForm> = {}): PilotForm => ({ ...emptyPilotForm(NOW), ...over });

describe('display names (CertificateType and MedicalClass extensions)', () => {
  it('cover every case with the Swift words', () => {
    expect(CERTIFICATE_TYPES.map((t) => CERTIFICATE_TYPE_NAMES[t])).toEqual([
      'Student Pilot',
      'Sport Pilot',
      'Recreational Pilot',
      'Private Pilot',
      'Commercial Pilot',
      'ATP',
    ]);
    expect(MEDICAL_CLASSES.map((c) => MEDICAL_CLASS_NAMES[c])).toEqual([
      'First Class',
      'Second Class',
      'Third Class',
      'BasicMed',
    ]);
  });
});

describe('emptyPilotForm', () => {
  it('is blank with the pickers at None and the date pickers at now', () => {
    expect(emptyPilotForm(NOW)).toEqual({
      name: '',
      certificateNumber: '',
      phone: '',
      email: '',
      certificateType: null,
      medicalClass: null,
      hasMedicalExpiry: false,
      medicalExpiry: NOW,
      hasFlightReview: false,
      flightReviewDate: NOW,
      totalHours: '',
    });
  });
});

describe('pilotFieldsFromForm (PilotEditView.saveProfile)', () => {
  it('stores the text as typed: no trimming, empty certificate number, phone and email become none', () => {
    const fields = pilotFieldsFromForm(form({ name: ' Ada ', certificateNumber: '', phone: '', email: '' }));
    expect(fields).toMatchObject({ name: ' Ada ', certificateNumber: null, phone: null, email: null });
    // Only an empty string is none; whitespace is kept, as in Swift (`isEmpty`).
    expect(pilotFieldsFromForm(form({ phone: ' ' })).phone).toBe(' ');
  });

  it('keeps the certificate type and medical class, or none', () => {
    expect(pilotFieldsFromForm(form({ certificateType: 'private', medicalClass: 'basicMed' }))).toMatchObject({
      certificateType: 'private',
      medicalClass: 'basicMed',
    });
    expect(pilotFieldsFromForm(form())).toMatchObject({ certificateType: null, medicalClass: null });
  });

  it('stores a date only while its switch is on', () => {
    const date = Date.UTC(2027, 5, 1, 12);
    const on = pilotFieldsFromForm(
      form({ hasMedicalExpiry: true, medicalExpiry: date, hasFlightReview: false, flightReviewDate: date }),
    );
    expect(on.medicalExpiry).toBe(date);
    expect(on.flightReviewDate).toBeNull();
    const other = pilotFieldsFromForm(
      form({ hasMedicalExpiry: false, medicalExpiry: date, hasFlightReview: true, flightReviewDate: date }),
    );
    expect(other.medicalExpiry).toBeNull();
    expect(other.flightReviewDate).toBe(date);
  });

  it.each([
    ['1234.5', 1234.5],
    ['300', 300],
    ['', null],
    ['12,5', null],
    ['abc', null],
  ])('total hours %j is stored as %s (Double(text))', (text, value) => {
    expect(pilotFieldsFromForm(form({ totalHours: text })).totalHours).toBe(value);
  });
});

describe('pilotFormFromProfile (PilotEditView.loadProfile)', () => {
  it('fills the form, showing hours the way Swift prints a Double', () => {
    const f = pilotFormFromProfile(
      pilot({
        name: 'Ada',
        certificateNumber: '123',
        phone: '555',
        email: 'ada@example.com',
        certificateType: 'private',
        medicalClass: 'third',
        medicalExpiry: Date.UTC(2027, 0, 1, 12),
        flightReviewDate: null,
        totalHours: 300,
      }),
      NOW,
    );
    expect(f).toEqual({
      name: 'Ada',
      certificateNumber: '123',
      phone: '555',
      email: 'ada@example.com',
      certificateType: 'private',
      medicalClass: 'third',
      hasMedicalExpiry: true,
      medicalExpiry: Date.UTC(2027, 0, 1, 12),
      hasFlightReview: false,
      flightReviewDate: NOW,
      totalHours: '300.0',
    });
  });

  it('an unknown stored certificate type or medical class reads as None', () => {
    const f = pilotFormFromProfile(pilot({ certificateType: 'astronaut', medicalClass: 'zeroth' }), NOW);
    expect(f.certificateType).toBeNull();
    expect(f.medicalClass).toBeNull();
  });

  it('missing values are empty text', () => {
    expect(pilotFormFromProfile(pilot(), NOW)).toMatchObject({
      certificateNumber: '',
      phone: '',
      email: '',
      totalHours: '',
    });
  });
});

describe('computePilotCurrency (PilotProfileViewModel.computeCurrency)', () => {
  it('no active pilot: everything reads expired', () => {
    expect(computePilotCurrency(null, NOW)).toEqual({
      medical: 'expired',
      flightReview: 'expired',
      night: 'expired',
      overall: 'expired',
    });
  });

  it('a pilot with nothing recorded is expired on all three', () => {
    expect(computePilotCurrency(pilot({ isActive: true }), NOW).overall).toBe('expired');
  });

  it('a fully current pilot is current, and the overall status is the most restrictive of the three', () => {
    const current = pilot({
      isActive: true,
      medicalExpiry: NOW + 200 * DAY,
      flightReviewDate: NOW - 30 * DAY,
      nightLandingEntries: [{ date: NOW - 10 * DAY, count: 3 }],
    });
    expect(computePilotCurrency(current, NOW)).toEqual({
      medical: 'current',
      flightReview: 'current',
      night: 'current',
      overall: 'current',
    });
    const expiring = { ...current, medicalExpiry: NOW + 10 * DAY };
    expect(computePilotCurrency(expiring, NOW)).toMatchObject({ medical: 'warning', overall: 'warning' });
    const lapsed = { ...expiring, nightLandingEntries: [{ date: NOW - 120 * DAY, count: 3 }] };
    expect(computePilotCurrency(lapsed, NOW)).toMatchObject({
      medical: 'warning',
      night: 'expired',
      overall: 'expired',
    });
  });

  it('night landings add up across entries inside 90 days', () => {
    const p = pilot({
      isActive: true,
      nightLandingEntries: [
        { date: NOW - 80 * DAY, count: 1 },
        { date: NOW - 10 * DAY, count: 2 },
      ],
    });
    expect(computePilotCurrency(p, NOW).night).toBe('current');
  });
});

describe('night landings', () => {
  it('shows the most recent entries first, at most ten, without changing the stored list', () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({ date: (i + 1) * DAY, count: 1 }));
    const recent = recentNightLandings(entries);
    expect(recent).toHaveLength(10);
    expect(recent[0].date).toBe(12 * DAY);
    expect(recent[9].date).toBe(3 * DAY);
    expect(entries[0].date).toBe(1 * DAY);
  });

  it('a short list is just sorted newest first', () => {
    expect(
      recentNightLandings([
        { date: 1, count: 1 },
        { date: 3, count: 2 },
        { date: 2, count: 3 },
      ]).map((e) => e.date),
    ).toEqual([3, 2, 1]);
  });

  it('addNightLanding appends and leaves the original list alone', () => {
    const before = [{ date: 1, count: 1 }];
    const after = addNightLanding(before, 5, 3);
    expect(after).toEqual([
      { date: 1, count: 1 },
      { date: 5, count: 3 },
    ]);
    expect(before).toHaveLength(1);
  });

  it.each([
    [1, '1 landing'],
    [0, '0 landings'],
    [2, '2 landings'],
    [10, '10 landings'],
  ])('%s reads "%s"', (count, text) => {
    expect(landingCountText(count)).toBe(text);
  });

  it('the entry sheet counts 1 to 10 and starts at 3', () => {
    expect(NIGHT_LANDING_STEPPER).toEqual({ min: 1, max: 10, initial: 3 });
  });
});

describe('rows (PilotRow, Pilot Info)', () => {
  it('a pilot with no name is "Unnamed Pilot"', () => {
    expect(pilotRowTitle(pilot({ name: '' }))).toBe('Unnamed Pilot');
    expect(pilotRowTitle(pilot({ name: 'Ada' }))).toBe('Ada');
  });

  it('the subtitle is the certificate type name when it is a known one', () => {
    expect(pilotRowSubtitle(pilot({ certificateType: 'sport' }))).toBe('Sport Pilot');
    expect(pilotRowSubtitle(pilot({ certificateType: 'astronaut' }))).toBeNull();
    expect(pilotRowSubtitle(pilot())).toBeNull();
  });

  it('Pilot Info lists the name (or "Not set") and only the details that exist', () => {
    expect(pilotInfoRows(pilot({ name: '' }))).toEqual([{ label: 'Name', value: 'Not set' }]);
    expect(
      pilotInfoRows(
        pilot({
          name: 'Ada',
          certificateNumber: '123',
          certificateType: 'private',
          totalHours: 300.25,
          medicalClass: 'third',
        }),
      ),
    ).toEqual([
      { label: 'Name', value: 'Ada' },
      { label: 'Certificate #', value: '123' },
      { label: 'Certificate Type', value: 'Private Pilot' },
      { label: 'Total Hours', value: '300.2' }, // %.1f of a tie: the even digit
    ]);
  });

  it('an empty certificate number and an unknown certificate type are left out', () => {
    expect(pilotInfoRows(pilot({ name: 'Ada', certificateNumber: '', certificateType: 'astronaut' }))).toEqual([
      { label: 'Name', value: 'Ada' },
    ]);
  });

  it('zero total hours are shown', () => {
    expect(pilotInfoRows(pilot({ name: 'Ada', totalHours: 0 })).at(-1)).toEqual({ label: 'Total Hours', value: '0.0' });
  });
});
