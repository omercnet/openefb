// Port of Services/IsraelFlightPlanMessage.swift: the ICAO FPL text and the Hebrew summary for a routed Israeli plan,
// plus the checks that block filing. Format: domestic AIP A-11 appendix A. Nothing here sends anything.
// Times are epoch ms; durations named `...Seconds` are seconds.
import { NETWORK_HEBREW_NAME, type IsraelReportingPoint } from '../../data/aviation/israelTypes';
import { israelClock } from './lsaTimeRules';
import {
  planNetwork,
  planPoints,
  planTotalETESeconds,
  type IsraelRoutePlan,
  type IsraelSegmentClosure,
  type IsraelUnresolvedClosure,
} from './routePlanner';

export interface IsraelFlightPlanInput {
  /** Registration as the pilot keeps it ("4X-ABC", "ABC", "4XABC"); normalised by `registrationField`. */
  registration: string;
  /** ICAO type designator ("C172"). null or empty: the message uses ZZZZ and TYP/ `typeDescription`. */
  typeDesignator?: string | null;
  /** Free-text type ("Cessna 172SP"), used for TYP/ when there is no designator. */
  typeDescription?: string | null;
  /** ICAO wake category letter; light aircraft by default. */
  wakeCategory?: string;
  /** Knots TAS. */
  cruiseSpeedKnots: number;
  /** Seconds of fuel on board; null omits E/. */
  enduranceSeconds?: number | null;
  /** null omits P/. */
  personsOnBoard?: number | null;
  /** Planned off-block time, epoch ms. */
  departure: number;
  picName: string;
  licenseNumber?: string | null;
  phone?: string | null;
  email?: string | null;
}

/** Where pilots send a domestic route flight plan (AIP A-11 3b(1)). Shown to the pilot; never used to send. */
export const FILING_ADDRESS = 'ais@iaa.gov.il';

/** Aerodromes with a real ICAO indicator; everything else is ZZZZ with DEP/ or DEST/. */
export function isICAOLocation(code: string): boolean {
  return /^LL[A-Z]{2}$/.test(code.toUpperCase());
}

const alnum = (text: string): string => [...text].filter((ch) => /[\p{L}\p{N}]/u.test(ch)).join('');

/** "HLH" and "4X-HLH" both give "4XHLH". Registrations that are already full-length keep their prefix. */
export function registrationField(registration: string): string {
  const cleaned = alnum(registration.toUpperCase());
  if (cleaned.startsWith('4X')) return cleaned;
  if (cleaned === '') return '';
  return [...cleaned].length <= 3 ? `4X${cleaned}` : cleaned;
}

/** "HHMM" for a duration in seconds. */
export function hhmm(seconds: number): string {
  const minutes = Math.max(0, Math.trunc(seconds / 60) || 0);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}${String(minutes % 60).padStart(2, '0')}`;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** FPL free text is upper-case ASCII without brackets or hyphens that would split a field. */
function sanitised(text: string): string {
  const folded = text.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
  return [...folded]
    .map((ch) => (/^[A-Z0-9 /]$/.test(ch) ? ch : ' '))
    .join('')
    .split(' ')
    .filter((part) => part !== '')
    .join(' ');
}

function utcFormat(epochMs: number, withYear: boolean): string {
  const d = new Date(epochMs);
  return withYear
    ? `${pad(d.getUTCFullYear() % 100)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
    : `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

function israelTime(epochMs: number): string {
  const c = israelClock(epochMs);
  return `${pad(c.hour)}:${pad(c.minute)}`;
}

function israelDate(epochMs: number): string {
  const c = israelClock(epochMs);
  return `${pad(c.day)}.${pad(c.month)}.${pad(c.year, 4)}`;
}

function remarks(input: IsraelFlightPlanInput): string {
  const parts = [`PIC ${sanitised(input.picName)}`];
  if (input.licenseNumber) parts.push(`LICENSE ${sanitised(input.licenseNumber)}`);
  if (input.phone) parts.push(`CELL ${[...input.phone].filter((ch) => /\p{N}/u.test(ch)).join('')}`);
  return parts.join(' ');
}

/** The ICAO FPL text, one field per line as the AIP example shows it. */
export function fpl(plan: IsraelRoutePlan, input: IsraelFlightPlanInput): string {
  const points = planPoints(plan);
  if (points.length === 0) return '';
  const dep = points[0];
  const dest = points[points.length - 1];
  const depICAO = isICAOLocation(dep.code);
  const destICAO = isICAOLocation(dest.code);

  let typeField = alnum((input.typeDesignator ?? '').toUpperCase());
  const needsTYP = typeField === '';
  if (needsTYP) typeField = 'ZZZZ';

  // EET rounds up to the next whole minute; the epsilon absorbs floating-point noise on exact minutes.
  const eet = hhmm(Math.ceil(planTotalETESeconds(plan) / 60 - 1e-6) * 60);
  const rounded = Math.round(input.cruiseSpeedKnots);
  const speed = `N${pad(Number.isFinite(rounded) ? rounded : 0, 4)}`;
  const via = points.slice(1, -1).map((p) => p.code);
  const route = via.length === 0 ? 'DCT' : via.join(' ');

  const field18: string[] = [];
  if (!depICAO) field18.push(`DEP/${dep.code.toUpperCase()}`);
  if (!destICAO) field18.push(`DEST/${dest.code.toUpperCase()}`);
  if (needsTYP && input.typeDescription) field18.push(`TYP/${sanitised(input.typeDescription)}`);
  field18.push(`DOF/${utcFormat(input.departure, true)}`);
  field18.push(`RMK/${remarks(input)}`);

  const lines = [
    `(FPL-${registrationField(input.registration)}-VG`,
    `-${typeField}/${(input.wakeCategory ?? 'L').toUpperCase()}-S/C`,
    `-${depICAO ? dep.code.toUpperCase() : 'ZZZZ'}${utcFormat(input.departure, false)}`,
    `-${speed}VFR ${route}`,
    `-${destICAO ? dest.code.toUpperCase() : 'ZZZZ'}${eet}`,
    `-${field18.join(' ')}`,
  ];
  let last = '';
  if (input.enduranceSeconds != null) last += `-E/${hhmm(input.enduranceSeconds)}`;
  if (input.personsOnBoard != null) last += `${last === '' ? '-' : ' '}P/${pad(input.personsOnBoard, 3)}`;
  if (last === '') lines[lines.length - 1] += ')';
  else lines.push(`${last})`);
  return lines.join('\n');
}

/** Wraps text in FSI ... PDI so its direction is resolved on its own and cannot leak into neighbours. */
export function isolated(text: string): string {
  return `\u2068${text}\u2069`;
}

function hebrewName(point: IsraelReportingPoint): string {
  const name = (point.nameHebrew ?? '').trim();
  return name === '' ? point.code : name;
}

/**
 * The Hebrew summary pilots paste next to the message, one fact per line. Times are local Israel time.
 * Every Latin or numeric run sits in a first-strong isolate so it keeps its own order.
 */
export function hebrewSummary(plan: IsraelRoutePlan, input: IsraelFlightPlanInput): string {
  const points = planPoints(plan);
  if (points.length === 0) return '';
  const dep = points[0];
  const dest = points[points.length - 1];
  const eta = input.departure + planTotalETESeconds(plan) * 1000;
  const route = points.map((p) => isolated(hebrewName(p))).join(' - ');
  return [
    `תכנית טיסה ב${NETWORK_HEBREW_NAME[planNetwork(plan)]}`,
    `המראה: ${isolated(hebrewName(dep))}, ${isolated(israelDate(input.departure))} בשעה ${isolated(israelTime(input.departure))} זמן מקומי`,
    `נתיב: ${route}`,
    `נחיתה: ${isolated(hebrewName(dest))} בשעה ${isolated(israelTime(eta))} זמן מקומי`,
  ].join('\n');
}

// MARK: Validation

export type IsraelFlightPlanIssueKind =
  | { kind: 'byRequestSegment'; value: string } // segment "FROM-TO"
  | { kind: 'militarySegment'; value: string }
  | { kind: 'wrongWay'; value: string } // one-way segment flown against its published direction
  | { kind: 'closedSegment'; value: string } // fully closed by NOTAM; "FROM-TO (NOTAM id)"
  | { kind: 'checkNotam'; value: string }
  | { kind: 'unresolvedClosure'; value: string } // NOTAM id of a closure the planner could not place
  | { kind: 'weekendStartUnconfirmed'; value: string } // weekend-only LSA route flown Friday before 14:00
  | { kind: 'notInUse'; value: string } // weekend-only LSA route flown outside a weekend
  | { kind: 'specialConditions'; value: string } // LSA route whose conditions are on the chart notes
  | { kind: 'closuresNotChecked' }
  | { kind: 'missingPilotField'; value: string } // "license", "phone", "name"
  | { kind: 'missingAircraftField'; value: string }; // "endurance", "persons on board", "registration"

export interface IsraelFlightPlanIssue {
  kind: IsraelFlightPlanIssueKind;
  /** true: "File" stays disabled until the route changes. */
  blocksFiling: boolean;
}

/** English text for the preview sheet. */
export function issueMessage(issue: IsraelFlightPlanIssue): string {
  const k = issue.kind;
  switch (k.kind) {
    case 'byRequestSegment':
      return `${k.value} is a by-request route. It needs real-time ATC approval and cannot be filed.`;
    case 'militarySegment':
      return `${k.value} is a military route. It needs IAF approval and cannot be filed.`;
    case 'wrongWay':
      return `${k.value} is a one-way route flown against its published direction.`;
    case 'closedSegment':
      return `${k.value} is closed by NOTAM.`;
    case 'checkNotam':
      return `NOTAM ${k.value} may close part of this route and could not be read in full. Read it before filing.`;
    case 'unresolvedClosure':
      return `Unresolved closure: check NOTAM ${k.value}. It could not be matched to the route network and may close this route.`;
    case 'weekendStartUnconfirmed':
      return `${k.value} is a weekend-only sport-aviation route. The AIP starts the weekend on Friday at 06:00, but some areas start it as late as 14:00 and the route data does not say which. Fly it from 14:00, or check the chart notes.`;
    case 'notInUse':
      return `${k.value} is a weekend-only sport-aviation route and this leg is flown outside a weekend.`;
    case 'specialConditions':
      return `${k.value} has special conditions on the CAAI chart notes. Read them before flying.`;
    case 'closuresNotChecked':
      return 'NOTAM closures were not checked: the feed is missing or out of date.';
    case 'missingPilotField':
      return `Pilot ${k.value} is missing from the pilot profile.`;
    case 'missingAircraftField':
      return `Aircraft ${k.value} is missing from the aircraft profile.`;
  }
}

/** The disclaimer shown with every preview (fpl.co.il shows the same duty). */
export const FLIGHT_PLAN_DISCLAIMER =
  'The pilot in command is responsible for checking the AIP, NOTAMs and weather. ' +
  `This app does not file anything: send the message to ${FILING_ADDRESS} yourself.`;

export interface ValidateOptions {
  /** Segment closure marks for the planned window. */
  closures?: ReadonlyMap<number, IsraelSegmentClosure>;
  unresolved?: readonly IsraelUnresolvedClosure[];
  /** false when the feed was missing or stale. */
  closuresChecked?: boolean;
  input?: IsraelFlightPlanInput | null;
}

export function validate(plan: IsraelRoutePlan, options: ValidateOptions = {}): IsraelFlightPlanIssue[] {
  const { closures = new Map(), unresolved = [], closuresChecked = true, input = null } = options;
  const issues: IsraelFlightPlanIssue[] = [];
  const add = (kind: IsraelFlightPlanIssueKind, blocksFiling: boolean): void => {
    const exists = issues.some((i) => JSON.stringify(i.kind) === JSON.stringify(kind));
    if (!exists) issues.push({ kind, blocksFiling });
  };
  for (const leg of plan.legs) {
    const name = `${leg.from.code}-${leg.to.code}`;
    if (leg.segment.isByRequest) add({ kind: 'byRequestSegment', value: name }, true);
    if (leg.segment.isMilitary) add({ kind: 'militarySegment', value: name }, true);
    if (leg.altitude === null) add({ kind: 'wrongWay', value: name }, true);
    const closure = closures.get(leg.segment.id);
    if (closure?.kind === 'full') add({ kind: 'closedSegment', value: `${name} (${closure.notamID})` }, true);
    else if (closure?.kind === 'check') add({ kind: 'checkNotam', value: closure.notamID }, true);
    for (const caution of leg.cautions) {
      if (caution.kind === 'weekendStartUnconfirmed') add({ kind: 'weekendStartUnconfirmed', value: name }, true);
      else if (caution.kind === 'notInUse') add({ kind: 'notInUse', value: name }, true);
      else if (caution.kind === 'specialConditions') add({ kind: 'specialConditions', value: name }, false);
    }
  }
  for (const closure of unresolved) add({ kind: 'unresolvedClosure', value: closure.notamID }, true);
  if (!closuresChecked) add({ kind: 'closuresNotChecked' }, false);
  if (input) {
    if (registrationField(input.registration) === '')
      add({ kind: 'missingAircraftField', value: 'registration' }, true);
    if (input.enduranceSeconds == null) add({ kind: 'missingAircraftField', value: 'endurance' }, false);
    if (input.personsOnBoard == null) add({ kind: 'missingAircraftField', value: 'persons on board' }, false);
    if (input.picName.trim() === '') add({ kind: 'missingPilotField', value: 'name' }, true);
    if (!input.licenseNumber) add({ kind: 'missingPilotField', value: 'license' }, false);
    if (!input.phone) add({ kind: 'missingPilotField', value: 'phone' }, false);
  }
  return issues;
}

export const canFile = (issues: readonly IsraelFlightPlanIssue[]): boolean => !issues.some((i) => i.blocksFiling);
