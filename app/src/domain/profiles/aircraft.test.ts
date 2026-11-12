// Characterisation of Views/Aircraft/AircraftEditView.swift (load and save of the form) and AircraftListView's AircraftRow.
// Swift has no test of these (the port map lists none); the cases follow the Swift source.
import { newAircraftProfile } from '../../data/defaults';
import type { AircraftProfile } from '../../data/models';
import {
  aircraftFormFromProfile,
  aircraftFromForm,
  aircraftRowSummary,
  choiceToNetwork,
  emptyAircraftForm,
  networkToChoice,
  ROUTE_NETWORK_OPTIONS,
  V_SPEED_FIELDS,
  type AircraftForm,
} from './aircraft';

const NOW = Date.UTC(2026, 10, 11, 9, 30);
const form = (over: Partial<AircraftForm> = {}): AircraftForm => ({
  ...emptyAircraftForm(NOW),
  nNumber: 'N12345',
  ...over,
});

describe('emptyAircraftForm (the @State defaults)', () => {
  it('is blank, with the date pickers at now and nothing switched on', () => {
    expect(emptyAircraftForm(NOW)).toEqual({
      nNumber: '',
      aircraftType: '',
      icaoType: '',
      personsOnBoard: '',
      routeNetwork: 'none',
      fuelCapacity: '',
      fuelBurn: '',
      cruiseSpeed: '',
      showVSpeeds: false,
      vSpeeds: { vr: '', vx: '', vy: '', va: '', vne: '', vfe: '', vs0: '', vs1: '' },
      hasAnnualDue: false,
      annualDue: NOW,
      hasTransponderDue: false,
      transponderDue: NOW,
    });
  });
});

describe('aircraftFromForm (saveProfile)', () => {
  it.each([
    ['empty', ''],
    ['spaces', '   '],
    ['tabs', '\t \t'],
  ])('an N-number that is %s is not saved: showValidationError', (_name, nNumber) => {
    expect(aircraftFromForm(form({ nNumber }))).toBeNull();
  });

  it('trims and upper-cases the N-number', () => {
    expect(aircraftFromForm(form({ nNumber: '  n12345 ' }))?.fields.nNumber).toBe('N12345');
  });

  it('keeps the aircraft type exactly as typed (no trim, no case change)', () => {
    expect(aircraftFromForm(form({ aircraftType: ' Cessna 172SP ' }))?.fields.aircraftType).toBe(' Cessna 172SP ');
  });

  it('the ICAO type is trimmed and upper-cased, and blank reads as none', () => {
    expect(aircraftFromForm(form({ icaoType: '  c172 ' }))?.fields.icaoTypeDesignator).toBe('C172');
    expect(aircraftFromForm(form({ icaoType: '   ' }))?.fields.icaoTypeDesignator).toBeNull();
    expect(aircraftFromForm(form({ icaoType: '' }))?.fields.icaoTypeDesignator).toBeNull();
  });

  it.each([
    ['180', 180],
    ['8.5', 8.5],
    ['', null],
    ['abc', null],
    ['12,5', null], // Double("12,5") is nil in Swift
    [' 12', null],
  ])('performance text %j is stored as %s (Double(text))', (text, value) => {
    const fields = aircraftFromForm(form({ fuelCapacity: text, fuelBurn: text, cruiseSpeed: text }))?.fields;
    expect(fields).toMatchObject({ fuelCapacityGallons: value, fuelBurnGPH: value, cruiseSpeedKts: value });
  });

  it.each([
    ['2', 2],
    ['', null],
    ['2.5', null],
    ['two', null],
  ])('persons on board %j is stored as %s (Int(text))', (text, value) => {
    expect(aircraftFromForm(form({ personsOnBoard: text }))?.fields.personsOnBoard).toBe(value);
  });

  describe('V-speeds', () => {
    const filled = { vr: '55', vx: '62', vy: '', va: '99', vne: '163', vfe: 'x', vs0: '40', vs1: '48.5' };

    it('are not stored while the toggle is off, even when the fields were filled', () => {
      expect(aircraftFromForm(form({ showVSpeeds: false, vSpeeds: filled }))?.fields.vSpeeds).toBeNull();
    });

    it('are stored as whole numbers when the toggle is on; blank and invalid fields are none', () => {
      expect(aircraftFromForm(form({ showVSpeeds: true, vSpeeds: filled }))?.fields.vSpeeds).toEqual({
        vr: 55,
        vx: 62,
        vy: null,
        va: 99,
        vne: 163,
        vfe: null,
        vs0: 40,
        vs1: null, // Int("48.5") is nil
      });
    });

    it('with the toggle on and every field blank, an all-empty set is stored (not nothing)', () => {
      const vSpeeds = aircraftFromForm(form({ showVSpeeds: true }))?.fields.vSpeeds;
      expect(vSpeeds).toEqual({ vr: null, vx: null, vy: null, va: null, vne: null, vfe: null, vs0: null, vs1: null });
    });

    it('are listed in the order and with the labels of the form', () => {
      expect(V_SPEED_FIELDS.map((f) => [f.key, f.label])).toEqual([
        ['vr', 'Vr (Rotation)'],
        ['vx', 'Vx (Best Angle)'],
        ['vy', 'Vy (Best Rate)'],
        ['va', 'Va (Maneuvering)'],
        ['vs0', 'Vs0 (Stall Landing)'],
        ['vs1', 'Vs1 (Stall Clean)'],
        ['vfe', 'Vfe (Max Flap)'],
        ['vne', 'Vne (Never Exceed)'],
      ]);
    });
  });

  it('inspection dates are stored only while their toggle is on', () => {
    const due = Date.UTC(2027, 2, 1, 12);
    const on = aircraftFromForm(
      form({ hasAnnualDue: true, annualDue: due, hasTransponderDue: false, transponderDue: due }),
    );
    expect(on?.fields.annualDue).toBe(due);
    expect(on?.fields.transponderDue).toBeNull();
    const other = aircraftFromForm(
      form({ hasAnnualDue: false, annualDue: due, hasTransponderDue: true, transponderDue: due }),
    );
    expect(other?.fields.annualDue).toBeNull();
    expect(other?.fields.transponderDue).toBe(due);
  });

  it('the usual route network is returned beside the fields (it is kept apart from the profile)', () => {
    expect(aircraftFromForm(form({ routeNetwork: 'lsa' }))?.routeNetwork).toBe('lsa');
    expect(aircraftFromForm(form({ routeNetwork: 'cvfr' }))?.routeNetwork).toBe('cvfr');
    expect(aircraftFromForm(form({ routeNetwork: 'none' }))?.routeNetwork).toBeNull();
  });
});

describe('aircraftFormFromProfile (loadProfile)', () => {
  const profile = (over: Partial<AircraftProfile> = {}): AircraftProfile =>
    newAircraftProfile('N12345', { id: 'a1', createdAt: 1, ...over });

  it('shows a stored Double the way Swift prints it: a whole number keeps ".0"', () => {
    const f = aircraftFormFromProfile(
      profile({
        aircraftType: 'Cessna 172SP',
        fuelCapacityGallons: 180,
        fuelBurnGPH: 8.5,
        cruiseSpeedKts: 110,
        personsOnBoard: 2,
        icaoTypeDesignator: 'C172',
      }),
      'cvfr',
      NOW,
    );
    expect(f).toMatchObject({
      nNumber: 'N12345',
      aircraftType: 'Cessna 172SP',
      fuelCapacity: '180.0',
      fuelBurn: '8.5',
      cruiseSpeed: '110.0',
      personsOnBoard: '2',
      icaoType: 'C172',
      routeNetwork: 'cvfr',
    });
  });

  it('missing values are empty text', () => {
    const f = aircraftFormFromProfile(profile(), null, NOW);
    expect(f).toMatchObject({
      fuelCapacity: '',
      fuelBurn: '',
      cruiseSpeed: '',
      personsOnBoard: '',
      icaoType: '',
      routeNetwork: 'none',
    });
  });

  it('V-speeds on: the toggle is on and the fields hold the whole numbers; off: toggle off', () => {
    const on = aircraftFormFromProfile(
      profile({ vSpeeds: { vr: 55, vx: null, vy: 70, va: null, vne: 163, vfe: null, vs0: 40, vs1: null } }),
      null,
      NOW,
    );
    expect(on.showVSpeeds).toBe(true);
    expect(on.vSpeeds).toEqual({ vr: '55', vx: '', vy: '70', va: '', vne: '163', vfe: '', vs0: '40', vs1: '' });
    expect(aircraftFormFromProfile(profile({ vSpeeds: null }), null, NOW).showVSpeeds).toBe(false);
  });

  it('an inspection date turns its toggle on and fills the picker; none leaves the picker at now', () => {
    const due = Date.UTC(2027, 2, 1, 12);
    const f = aircraftFormFromProfile(profile({ annualDue: due, transponderDue: null }), null, NOW);
    expect(f).toMatchObject({ hasAnnualDue: true, annualDue: due, hasTransponderDue: false, transponderDue: NOW });
  });

  it('saving what was loaded changes nothing (only the number text is normalised)', () => {
    const original = profile({
      aircraftType: 'PA-28',
      fuelCapacityGallons: 48,
      fuelBurnGPH: 9.5,
      cruiseSpeedKts: 105,
      personsOnBoard: 3,
      icaoTypeDesignator: 'P28A',
      vSpeeds: { vr: 55, vx: 63, vy: 79, va: 111, vne: 154, vfe: 103, vs0: 44, vs1: 50 },
      annualDue: Date.UTC(2027, 0, 5, 12),
      transponderDue: null,
    });
    const saved = aircraftFromForm(aircraftFormFromProfile(original, 'lsa', NOW));
    expect(saved?.fields).toEqual({
      nNumber: original.nNumber,
      aircraftType: original.aircraftType,
      fuelCapacityGallons: 48,
      fuelBurnGPH: 9.5,
      cruiseSpeedKts: 105,
      icaoTypeDesignator: 'P28A',
      personsOnBoard: 3,
      vSpeeds: original.vSpeeds,
      annualDue: original.annualDue,
      transponderDue: null,
    });
    expect(saved?.routeNetwork).toBe('lsa');
  });
});

describe('aircraftRowSummary (AircraftRow)', () => {
  const p = (over: Partial<AircraftProfile>): AircraftProfile =>
    newAircraftProfile('N12345', { id: 'a1', createdAt: 1, ...over });

  it('shows the N-number, and the type only when there is one', () => {
    expect(aircraftRowSummary(p({}))).toEqual({ title: 'N12345', subtitle: null, fuelLine: null });
    expect(aircraftRowSummary(p({ aircraftType: 'Cessna 172SP' })).subtitle).toBe('Cessna 172SP');
  });

  it('the fuel line needs both the capacity and the burn: whole gallons, burn to one decimal', () => {
    expect(aircraftRowSummary(p({ fuelCapacityGallons: 180, fuelBurnGPH: 8.5 })).fuelLine).toBe('180 gal / 8.5 GPH');
    expect(aircraftRowSummary(p({ fuelCapacityGallons: 180 })).fuelLine).toBeNull();
    expect(aircraftRowSummary(p({ fuelBurnGPH: 8.5 })).fuelLine).toBeNull();
  });

  it('gallons truncate (Int(fuel)) and the burn follows printf rounding', () => {
    expect(aircraftRowSummary(p({ fuelCapacityGallons: 180.9, fuelBurnGPH: 8.25 })).fuelLine).toBe('180 gal / 8.2 GPH');
    expect(aircraftRowSummary(p({ fuelCapacityGallons: 0.9, fuelBurnGPH: 8 })).fuelLine).toBe('0 gal / 8.0 GPH');
  });
});

describe('route network choices', () => {
  it('are Not set, CVFR and LSA with the Swift titles', () => {
    expect(ROUTE_NETWORK_OPTIONS).toEqual([
      { value: 'none', title: 'Not set' },
      { value: 'cvfr', title: 'CVFR (general aviation)' },
      { value: 'lsa', title: 'LSA / sport aviation' },
    ]);
  });

  it('map to and from the stored network', () => {
    expect(networkToChoice(null)).toBe('none');
    expect(networkToChoice('lsa')).toBe('lsa');
    expect(choiceToNetwork('none')).toBeNull();
    expect(choiceToNetwork('cvfr')).toBe('cvfr');
  });
});
