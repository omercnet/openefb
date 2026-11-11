// The logic of Views/Aircraft/PilotEditView.swift, PilotProfileView.swift and ViewModels/PilotProfileViewModel.swift as pure
// functions: the edit form, the rows, the night landing list and the currency of the active pilot.
import {
  certificateTypeOf,
  medicalClassOf,
  type CertificateType,
  type MedicalClass,
  type NightLandingEntry,
  type PilotProfile,
} from '../../data/models';
import {
  flightReviewStatus,
  medicalStatus,
  nightCurrencyStatus,
  overallStatus,
  type CurrencyStatus,
} from '../currency';
import { doubleText, fixed1, parseSwiftDouble } from '../numberFormat';

/** `CertificateType.displayName` */
export const CERTIFICATE_TYPE_NAMES: Record<CertificateType, string> = {
  student: 'Student Pilot',
  sport: 'Sport Pilot',
  recreational: 'Recreational Pilot',
  private: 'Private Pilot',
  commercial: 'Commercial Pilot',
  atp: 'ATP',
};

/** `MedicalClass.displayName` */
export const MEDICAL_CLASS_NAMES: Record<MedicalClass, string> = {
  first: 'First Class',
  second: 'Second Class',
  third: 'Third Class',
  basicMed: 'BasicMed',
};

/** The @State of PilotEditView. */
export interface PilotForm {
  name: string;
  certificateNumber: string;
  phone: string;
  email: string;
  certificateType: CertificateType | null;
  medicalClass: MedicalClass | null;
  hasMedicalExpiry: boolean;
  medicalExpiry: number;
  hasFlightReview: boolean;
  flightReviewDate: number;
  totalHours: string;
}

/** The fields of a PilotProfile the form writes. */
export type PilotFields = Pick<
  PilotProfile,
  | 'name'
  | 'certificateNumber'
  | 'phone'
  | 'email'
  | 'certificateType'
  | 'medicalClass'
  | 'medicalExpiry'
  | 'flightReviewDate'
  | 'totalHours'
>;

/** loadProfile. An unknown stored certificate type or medical class reads as None, and saving then clears it. */
export function pilotFormFromProfile(profile: PilotProfile, now: number): PilotForm {
  return {
    name: profile.name,
    certificateNumber: profile.certificateNumber ?? '',
    phone: profile.phone ?? '',
    email: profile.email ?? '',
    certificateType: certificateTypeOf(profile),
    medicalClass: medicalClassOf(profile),
    hasMedicalExpiry: profile.medicalExpiry !== null,
    medicalExpiry: profile.medicalExpiry ?? now,
    hasFlightReview: profile.flightReviewDate !== null,
    flightReviewDate: profile.flightReviewDate ?? now,
    totalHours: profile.totalHours === null ? '' : doubleText(profile.totalHours),
  };
}

/** saveProfile: the text is stored as typed (no trimming); only an empty string is none. Hours are read as `Double(text)`. */
export function pilotFieldsFromForm(form: PilotForm): PilotFields {
  return {
    name: form.name,
    certificateNumber: form.certificateNumber === '' ? null : form.certificateNumber,
    phone: form.phone === '' ? null : form.phone,
    email: form.email === '' ? null : form.email,
    certificateType: form.certificateType,
    medicalClass: form.medicalClass,
    medicalExpiry: form.hasMedicalExpiry ? form.medicalExpiry : null,
    flightReviewDate: form.hasFlightReview ? form.flightReviewDate : null,
    totalHours: parseSwiftDouble(form.totalHours),
  };
}

export interface PilotCurrency {
  medical: CurrencyStatus;
  flightReview: CurrencyStatus;
  night: CurrencyStatus;
  /** The most restrictive of the three. */
  overall: CurrencyStatus;
}

const NO_PILOT: PilotCurrency = { medical: 'expired', flightReview: 'expired', night: 'expired', overall: 'expired' };

/** computeCurrency: FAR 61.23 (medical), 61.56 (flight review), 61.57 (night) for the active pilot; none active reads expired. */
export function computePilotCurrency(profile: PilotProfile | null, now: number): PilotCurrency {
  if (profile === null) return NO_PILOT;
  const medical = medicalStatus(profile.medicalExpiry, now);
  const flightReview = flightReviewStatus(profile.flightReviewDate, now);
  const night = nightCurrencyStatus(profile.nightLandingEntries, now);
  return { medical, flightReview, night, overall: overallStatus(medical, flightReview, night) };
}

/** The night landing sheet: 1 to 10 landings, starting at 3. */
export const NIGHT_LANDING_STEPPER = { min: 1, max: 10, initial: 3 } as const;

/** The entries the profile lists: newest first, the last 10. */
export function recentNightLandings(entries: readonly NightLandingEntry[], limit = 10): NightLandingEntry[] {
  return [...entries].sort((a, b) => b.date - a.date).slice(0, limit);
}

/** addNightLandings: the list with one more entry (appended, not re-sorted). */
export const addNightLanding = (
  entries: readonly NightLandingEntry[],
  date: number,
  count: number,
): NightLandingEntry[] => [...entries, { date, count }];

export const landingCountText = (count: number): string => `${count} landing${count === 1 ? '' : 's'}`;

export const pilotRowTitle = (profile: PilotProfile): string => (profile.name === '' ? 'Unnamed Pilot' : profile.name);

export function pilotRowSubtitle(profile: PilotProfile): string | null {
  const type = certificateTypeOf(profile);
  return type === null ? null : CERTIFICATE_TYPE_NAMES[type];
}

export interface PilotInfoRow {
  label: string;
  value: string;
}

/** Pilot Info: the name (or "Not set") and the details that exist. */
export function pilotInfoRows(profile: PilotProfile): PilotInfoRow[] {
  const rows: PilotInfoRow[] = [{ label: 'Name', value: profile.name === '' ? 'Not set' : profile.name }];
  if (profile.certificateNumber !== null && profile.certificateNumber !== '') {
    rows.push({ label: 'Certificate #', value: profile.certificateNumber });
  }
  const type = certificateTypeOf(profile);
  if (type !== null) rows.push({ label: 'Certificate Type', value: CERTIFICATE_TYPE_NAMES[type] });
  if (profile.totalHours !== null) rows.push({ label: 'Total Hours', value: fixed1(profile.totalHours) });
  return rows;
}
