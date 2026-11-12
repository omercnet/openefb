// The form logic of Views/Aircraft/AircraftEditView.swift (loadProfile, saveProfile) and the row text of AircraftListView
// (AircraftRow), as pure functions. The view only lays the form out.
import type { IsraelRouteNetwork } from '../../data/aviation/israelTypes';
import type { AircraftProfile, VSpeeds } from '../../data/models';
import { doubleText, fixed1, parseSwiftDouble, parseSwiftInt } from '../numberFormat';

export type VSpeedKey = keyof VSpeeds;

/** The V-speed fields in the order the form lists them. */
export const V_SPEED_FIELDS: readonly { key: VSpeedKey; label: string }[] = [
  { key: 'vr', label: 'Vr (Rotation)' },
  { key: 'vx', label: 'Vx (Best Angle)' },
  { key: 'vy', label: 'Vy (Best Rate)' },
  { key: 'va', label: 'Va (Maneuvering)' },
  { key: 'vs0', label: 'Vs0 (Stall Landing)' },
  { key: 'vs1', label: 'Vs1 (Stall Clean)' },
  { key: 'vfe', label: 'Vfe (Max Flap)' },
  { key: 'vne', label: 'Vne (Never Exceed)' },
];

/** The picker's choice: `nil` is "Not set". */
export type RouteNetworkChoice = 'none' | IsraelRouteNetwork;

export const ROUTE_NETWORK_OPTIONS: readonly { value: RouteNetworkChoice; title: string }[] = [
  { value: 'none', title: 'Not set' },
  { value: 'cvfr', title: 'CVFR (general aviation)' },
  { value: 'lsa', title: 'LSA / sport aviation' },
];

export const networkToChoice = (network: IsraelRouteNetwork | null): RouteNetworkChoice => network ?? 'none';
export const choiceToNetwork = (choice: RouteNetworkChoice): IsraelRouteNetwork | null =>
  choice === 'none' ? null : choice;

/** The @State of AircraftEditView: text for every number, a switch and a date for each optional date. */
export interface AircraftForm {
  nNumber: string;
  aircraftType: string;
  icaoType: string;
  personsOnBoard: string;
  routeNetwork: RouteNetworkChoice;
  fuelCapacity: string;
  fuelBurn: string;
  cruiseSpeed: string;
  showVSpeeds: boolean;
  vSpeeds: Record<VSpeedKey, string>;
  hasAnnualDue: boolean;
  annualDue: number;
  hasTransponderDue: boolean;
  transponderDue: number;
}

/** The fields of an AircraftProfile the form writes. */
export type AircraftFields = Pick<
  AircraftProfile,
  | 'nNumber'
  | 'aircraftType'
  | 'fuelCapacityGallons'
  | 'fuelBurnGPH'
  | 'cruiseSpeedKts'
  | 'icaoTypeDesignator'
  | 'personsOnBoard'
  | 'vSpeeds'
  | 'annualDue'
  | 'transponderDue'
>;

export interface AircraftInput {
  fields: AircraftFields;
  /** Stored apart from the profile (IsraelAircraftNetworkPreference): one string per aircraft. */
  routeNetwork: IsraelRouteNetwork | null;
}

const blankVSpeeds = (): Record<VSpeedKey, string> => ({
  vr: '',
  vx: '',
  vy: '',
  va: '',
  vne: '',
  vfe: '',
  vs0: '',
  vs1: '',
});

/** A new aircraft: everything blank, the date pickers at now. */
export const emptyAircraftForm = (now: number): AircraftForm => ({
  nNumber: '',
  aircraftType: '',
  icaoType: '',
  personsOnBoard: '',
  routeNetwork: 'none',
  fuelCapacity: '',
  fuelBurn: '',
  cruiseSpeed: '',
  showVSpeeds: false,
  vSpeeds: blankVSpeeds(),
  hasAnnualDue: false,
  annualDue: now,
  hasTransponderDue: false,
  transponderDue: now,
});

const orEmpty = (value: number | null, text: (n: number) => string): string => (value === null ? '' : text(value));

/** loadProfile: the form for an existing aircraft. Stored numbers are shown as Swift's `String(Double)` prints them. */
export function aircraftFormFromProfile(
  profile: AircraftProfile,
  routeNetwork: IsraelRouteNetwork | null,
  now: number,
): AircraftForm {
  const vSpeeds = blankVSpeeds();
  for (const { key } of V_SPEED_FIELDS) vSpeeds[key] = orEmpty(profile.vSpeeds?.[key] ?? null, String);
  return {
    nNumber: profile.nNumber,
    aircraftType: profile.aircraftType,
    icaoType: profile.icaoTypeDesignator ?? '',
    personsOnBoard: orEmpty(profile.personsOnBoard, String),
    routeNetwork: networkToChoice(routeNetwork),
    fuelCapacity: orEmpty(profile.fuelCapacityGallons, doubleText),
    fuelBurn: orEmpty(profile.fuelBurnGPH, doubleText),
    cruiseSpeed: orEmpty(profile.cruiseSpeedKts, doubleText),
    showVSpeeds: profile.vSpeeds !== null,
    vSpeeds,
    hasAnnualDue: profile.annualDue !== null,
    annualDue: profile.annualDue ?? now,
    hasTransponderDue: profile.transponderDue !== null,
    transponderDue: profile.transponderDue ?? now,
  };
}

/**
 * saveProfile: what the form writes, or null when the N-number is blank (the form then shows "N-number is required").
 * Numbers are read the Swift way (`Double(text)`, `Int(text)`: no whitespace, "." only); an unreadable one is stored as none.
 */
export function aircraftFromForm(form: AircraftForm): AircraftInput | null {
  const nNumber = form.nNumber.trim();
  if (nNumber === '') return null;
  const icao = form.icaoType.trim();
  const v = form.vSpeeds;
  return {
    fields: {
      nNumber: nNumber.toUpperCase(),
      aircraftType: form.aircraftType,
      fuelCapacityGallons: parseSwiftDouble(form.fuelCapacity),
      fuelBurnGPH: parseSwiftDouble(form.fuelBurn),
      cruiseSpeedKts: parseSwiftDouble(form.cruiseSpeed),
      icaoTypeDesignator: icao === '' ? null : icao.toUpperCase(),
      personsOnBoard: parseSwiftInt(form.personsOnBoard),
      vSpeeds: form.showVSpeeds
        ? {
            vr: parseSwiftInt(v.vr),
            vx: parseSwiftInt(v.vx),
            vy: parseSwiftInt(v.vy),
            va: parseSwiftInt(v.va),
            vne: parseSwiftInt(v.vne),
            vfe: parseSwiftInt(v.vfe),
            vs0: parseSwiftInt(v.vs0),
            vs1: parseSwiftInt(v.vs1),
          }
        : null,
      annualDue: form.hasAnnualDue ? form.annualDue : null,
      transponderDue: form.hasTransponderDue ? form.transponderDue : null,
    },
    routeNetwork: choiceToNetwork(form.routeNetwork),
  };
}

export interface AircraftRowSummary {
  title: string;
  subtitle: string | null;
  /** "180 gal / 8.5 GPH": needs both numbers. */
  fuelLine: string | null;
}

/** AircraftRow: the N-number, the type when there is one, and the fuel line. Gallons truncate (`Int(fuel)`). */
export function aircraftRowSummary(profile: AircraftProfile): AircraftRowSummary {
  const { fuelCapacityGallons: fuel, fuelBurnGPH: burn } = profile;
  return {
    title: profile.nNumber,
    subtitle: profile.aircraftType === '' ? null : profile.aircraftType,
    fuelLine: fuel !== null && burn !== null ? `${Math.trunc(fuel)} gal / ${fixed1(burn)} GPH` : null,
  };
}
