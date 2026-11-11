// Ports of DataTests/ProfileModelTests, DataTests/LogbookEntryTests (model-level cases) and the stored-default cases of
// CharacterizationTests/SwiftDataMigrationCharacterizationTests. View-model cases are listed in docs/port-notes/D2.md.
import {
  newAircraftProfile,
  newFlightPlanRecord,
  newFlightRecord,
  newLogbookEntry,
  newPilotProfile,
  newUserSettings,
} from '../../src/data/defaults';
import {
  RECOVERED_NOTE,
  TRACK_UNREADABLE_NOTE,
  certificateTypeOf,
  healthWarning,
  isAircraftValid,
  medicalClassOf,
  regionOf,
} from '../../src/data/models';

describe('Profile Model Tests', () => {
  it('aircraftProfileCreation', () => {
    const profile = newAircraftProfile('N4543A');
    expect(profile.nNumber).toBe('N4543A');
    expect(profile.isActive).toBe(false);
    expect(profile.id).not.toBe('00000000-0000-0000-0000-000000000000');
    expect(profile.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('aircraftIsValidWithNNumber', () => expect(isAircraftValid(newAircraftProfile('N123AB'))).toBe(true));
  it('aircraftIsInvalidWithEmptyNNumber', () => expect(isAircraftValid(newAircraftProfile(''))).toBe(false));
  it('pilotProfileCreation', () => {
    const profile = newPilotProfile({ name: 'Test Pilot' });
    expect(profile.name).toBe('Test Pilot');
  });
  it('pilotMedicalClassEnumRoundTrip', () => {
    const profile = newPilotProfile({ medicalClass: 'first' });
    expect(medicalClassOf(profile)).toBe('first');
    expect(medicalClassOf(newPilotProfile({ medicalClass: 'nonsense' }))).toBeNull();
    expect(medicalClassOf(newPilotProfile())).toBeNull();
  });
  it('pilotCertificateTypeEnumRoundTrip', () => {
    const profile = newPilotProfile({ certificateType: 'private' });
    expect(certificateTypeOf(profile)).toBe('private');
    expect(certificateTypeOf(newPilotProfile({ certificateType: 'privatePilot' }))).toBeNull();
  });
});

describe('LogbookEntry Tests', () => {
  it('defaultValues', () => {
    const entry = newLogbookEntry();
    expect(entry.isConfirmed).toBe(false);
    expect(entry.nightLandingCount).toBe(0);
    expect(entry.dayLandingCount).toBe(0);
    expect(entry.durationSeconds).toBe(0);
    expect(entry.flightID).toBeNull();
    expect(entry.departureICAO).toBeNull();
    expect(entry.arrivalICAO).toBeNull();
    expect(entry.hasDebrief).toBe(false);
    expect(entry.notes).toBeNull();
  });
});

describe('SwiftData Migration Characterization (stored defaults)', () => {
  it('userSettingsStoredDefaults', () => {
    const settings = newUserSettings();
    expect(settings.defaultMapMode).toBe('northUp');
    expect(settings.sectionalOpacity).toBe(0.7);
    expect(settings.weatherRefreshInterval).toBe(900);
    expect(settings.activeAircraftID).toBeNull();
    expect(settings.activePilotID).toBeNull();
    expect(settings.lastFlightPlanID).toBeNull();
    expect(settings.regionRaw).toBe('israel');
    expect(regionOf(settings)).toBe('israel');
  });
  it('userSettingsUnknownRegionRawReadsAsDefaultAndSetterWritesRaw', () => {
    const settings = newUserSettings({ regionRaw: 'atlantis' });
    expect(regionOf(settings)).toBe('israel');
    expect(settings.regionRaw).toBe('atlantis');
    expect(regionOf(newUserSettings({ regionRaw: 'us' }))).toBe('us');
  });
  it('flight plan and flight record defaults match the Swift initialisers', () => {
    const plan = newFlightPlanRecord({ now: () => 5, newId: () => 'p' });
    expect(plan).toMatchObject({ id: 'p', cruiseAltitude: 3000, cruiseSpeedKts: 100, lastUsedAt: 5, createdAt: 5 });
    const flight = newFlightRecord({ now: () => 7, newId: () => 'f' });
    expect(flight).toMatchObject({ audioQuality: 'standard', trackPointCount: 0, startDate: 7, hasDebrief: false });
  });
});

describe('FlightRecord health warning', () => {
  it.each([
    [TRACK_UNREADABLE_NOTE, 'Track damaged'],
    [`${TRACK_UNREADABLE_NOTE} more`, 'Track damaged'],
    [RECOVERED_NOTE, 'Recovered'],
    ['A normal note', null],
    [null, null],
  ])('healthWarning(%j) = %j', (notes, expected) => {
    expect(healthWarning(newFlightRecord({ notes }))).toBe(expected);
  });
});
