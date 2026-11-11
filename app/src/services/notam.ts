// Port of the FAA NOTAM models and pure helpers (Services/NotamService.swift): Notam, closures, briefing order, the
// geoJson page decoder and the location query. Times are epoch ms (UTC).
import type { Airport } from '../domain/core/models';
import { parseIsoDateTime } from './isoDate';
import { asObject, DecodeError, optArray, optInt, optObject, optString, type JsonObject } from './jsonDecode';

export const NOTAM_ENDPOINT = 'https://external-api.faa.gov/notamapi/v1/notams';

// MARK: Models

export type NotamClosure = 'aerodrome' | 'runway';
/** Aerodrome closures sort before runway closures. */
const CLOSURE_RANK: Record<NotamClosure, number> = { aerodrome: 0, runway: 1 };

export const closureLabel = (c: NotamClosure): string => (c === 'aerodrome' ? 'AD CLSD' : 'RWY CLSD');

export interface Notam {
  id: string; // FAA NOTAM id, e.g. "NOTAM_1_74012345"
  number: string; // e.g. "10/045"
  series: string | null;
  type: string | null; // N = new, R = replace, C = cancel
  issued: number | null;
  effectiveStart: number | null; // nil = unknown (treated as already effective)
  effectiveEnd: number | null; // nil = permanent ("PERM") or unspecified
  isPermanent: boolean;
  text: string; // NOTAM body, e.g. "RWY 13/31 CLSD"
  fullText: string | null; // LOCAL_FORMAT simpleText or ICAO formattedText translation
  classification: string | null; // DOM, FDC, INTL, MIL, LMIL
  location: string | null; // FAA location, e.g. "PAO"
  icaoLocation: string | null; // e.g. "KPAO"
  selectionCode: string | null; // ICAO Q-code, e.g. "QMRLC"
  schedule: string | null;
}

/** Swift's memberwise initialiser with defaults. */
export function makeNotam(
  fields: Pick<Notam, 'id' | 'number' | 'effectiveStart' | 'effectiveEnd' | 'text'> & Partial<Notam>,
): Notam {
  return {
    series: null,
    type: null,
    issued: null,
    isPermanent: false,
    fullText: null,
    classification: null,
    location: null,
    icaoLocation: null,
    selectionCode: null,
    schedule: null,
    ...fields,
  };
}

/** A cancellation NOTAM ("C") only announces that another NOTAM ended. */
export const isCancellation = (n: Notam): boolean => n.type?.toUpperCase() === 'C';

/** Effective at `atMs`: started (or start unknown) and not yet ended (or permanent). Start inclusive, end exclusive. */
export function isEffective(n: Notam, atMs: number): boolean {
  if (n.effectiveStart !== null && n.effectiveStart > atMs) return false;
  if (n.effectiveEnd !== null && n.effectiveEnd <= atMs) return false;
  return true;
}

export function notamClosure(n: Notam): NotamClosure | null {
  const code = n.selectionCode?.toUpperCase() ?? '';
  if (code.startsWith('QFALC')) return 'aerodrome';
  if (code.startsWith('QMRLC')) return 'runway';

  const body = n.text.toUpperCase();
  if (/\bAD\s+AP\s+CLSD\b|\bA[DP]\s+CLSD\b/.test(body)) return 'aerodrome';
  if (/\bRWY\s+\d{1,2}[LRC]?(\/\d{1,2}[LRC]?)?\s+CLSD\b/.test(body)) return 'runway';
  return null;
}

/** Briefing order as a sort comparator: aerodrome closures, then runway closures, then everything else; within a
 * group the most recently effective first, then by number. */
export function compareBriefingOrder(lhs: Notam, rhs: Notam): number {
  const l = notamClosure(lhs);
  const r = notamClosure(rhs);
  if (l !== null && r !== null && l !== r) return CLOSURE_RANK[l] - CLOSURE_RANK[r];
  if (l !== null && r === null) return -1;
  if (l === null && r !== null) return 1;
  const lStart = lhs.effectiveStart ?? -Infinity;
  const rStart = rhs.effectiveStart ?? -Infinity;
  if (lStart !== rStart) return lStart > rStart ? -1 : 1;
  if (lhs.number < rhs.number) return -1;
  if (lhs.number > rhs.number) return 1;
  return 0;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 30 1400Z" (Swift: MMM d HHmm'Z', en_US_POSIX, UTC). */
function utcStamp(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${hh}${mm}Z`;
}

/** e.g. "Oct 30 1400Z - Oct 31 0200Z" or "Oct 30 1400Z - PERM" (en dash; the start is an em dash when unknown). */
export function effectiveWindowDescription(n: Notam): string {
  const start = n.effectiveStart !== null ? utcStamp(n.effectiveStart) : '\u2014';
  const end = n.effectiveEnd !== null ? utcStamp(n.effectiveEnd) : n.isPermanent ? 'PERM' : 'UFN';
  return `${start} \u2013 ${end}`;
}

/** One airport's effective NOTAMs plus when they were fetched from the FAA. */
export interface NotamReport {
  location: string;
  notams: Notam[];
  /** When the FAA last answered with this data. A fallback copy keeps its original time, so the data-age badge shows
   * the true age rather than the time of the failed refresh. */
  fetchedAt: number;
  /** The latest refresh failed; `notams` is the last good copy. */
  refreshFailed: boolean;
  /** The page cap or time budget stopped the download: later pages (possibly closures) are missing. */
  isIncomplete: boolean;
}

/** One decoded page of the FAA response. */
export interface NotamPage {
  notams: Notam[];
  pageNum: number;
  totalPages: number;
  totalCount: number;
}

// MARK: Pure helpers

export interface LocationQuery {
  name: 'icaoLocation' | 'domesticLocation';
  value: string;
}

/** `icaoLocation` for 4-letter ICAO idents (KPAO), otherwise `domesticLocation` with the FAA LID (0Q5). */
export function locationQuery(airport: Pick<Airport, 'icao' | 'faaID'>): LocationQuery {
  const icao = airport.icao.toUpperCase();
  const chars = [...icao];
  if (chars.length === 4 && chars.every((c) => /\p{L}/u.test(c))) return { name: 'icaoLocation', value: icao };
  return { name: 'domesticLocation', value: (airport.faaID ?? airport.icao).toUpperCase() };
}

/** Drops cancellations and NOTAMs not effective at `atMs`, then sorts closures first. */
export function activeSorted(notams: readonly Notam[], atMs: number): Notam[] {
  return notams.filter((n) => !isCancellation(n) && isEffective(n, atMs)).sort(compareBriefingOrder);
}

const trimSpaces = (s: string): string => s.replace(/^[ \t]+|[ \t]+$/g, '');

/** FAA times are ISO 8601 UTC; some arrive with an "EST" suffix, which Swift drops. */
function faaDate(text: string | null): number | null {
  if (text === null) return null;
  let value = trimSpaces(text);
  if (value === '') return null;
  if (value.toUpperCase().endsWith('EST')) value = trimSpaces(value.slice(0, -3));
  return parseIsoDateTime(value);
}

/** Decode one geoJson page of the FAA NOTAM API response. Throws DecodeError on a malformed payload. */
export function parseNotamResponse(body: string): NotamPage {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new DecodeError('the response is not JSON');
  }
  const root = asObject(json, 'response');
  const pageNum = optInt(root, 'pageNum');
  const totalPages = optInt(root, 'totalPages');
  const totalCount = optInt(root, 'totalCount');
  optInt(root, 'pageSize');
  const items = (optArray(root, 'items') ?? []).map((item) => asObject(item, 'items[]'));

  const notams: Notam[] = [];
  for (const item of items) {
    optString(item, 'type');
    const core = optObject(optObject(item, 'properties') ?? {}, 'coreNOTAMData');
    const raw = core ? optObject(core, 'notam') : null;
    const translations = (core ? optArray(core, 'notamTranslation') : null)?.map((t) =>
      asObject(t, 'notamTranslation[]'),
    );
    const fields = raw ? decodeFields(raw) : null;
    const decodedTranslations = (translations ?? []).map((t) => ({
      type: optString(t, 'type'),
      simpleText: optString(t, 'simpleText'),
      formattedText: optString(t, 'formattedText'),
    }));
    const id = fields ? (fields.id ?? fields.number) : null;
    if (!fields || id === null) continue;

    const fullText =
      decodedTranslations.find((t) => t.type === 'LOCAL_FORMAT')?.simpleText ??
      decodedTranslations.find((t) => t.type === 'ICAO')?.formattedText ??
      decodedTranslations.map((t) => t.simpleText ?? t.formattedText).find((t) => t !== null && t !== undefined) ??
      null;

    const endRaw = fields.effectiveEnd === null ? null : trimSpaces(fields.effectiveEnd).toUpperCase();
    const isPermanent = endRaw === 'PERM';

    notams.push({
      id,
      number: fields.number ?? id,
      series: fields.series,
      type: fields.type,
      issued: faaDate(fields.issued),
      effectiveStart: faaDate(fields.effectiveStart),
      effectiveEnd: isPermanent ? null : faaDate(fields.effectiveEnd),
      isPermanent,
      text: (fields.text ?? fullText ?? '').trim(),
      fullText,
      classification: fields.classification,
      location: fields.location,
      icaoLocation: fields.icaoLocation,
      selectionCode: fields.selectionCode,
      schedule: fields.schedule,
    });
  }

  return {
    notams,
    pageNum: pageNum ?? 1,
    totalPages: totalPages ?? 1,
    totalCount: totalCount ?? notams.length,
  };
}

function decodeFields(raw: JsonObject) {
  return {
    id: optString(raw, 'id'),
    series: optString(raw, 'series'),
    number: optString(raw, 'number'),
    type: optString(raw, 'type'),
    issued: optString(raw, 'issued'),
    selectionCode: optString(raw, 'selectionCode'),
    location: optString(raw, 'location'),
    effectiveStart: optString(raw, 'effectiveStart'),
    effectiveEnd: optString(raw, 'effectiveEnd'),
    text: optString(raw, 'text'),
    classification: optString(raw, 'classification'),
    icaoLocation: optString(raw, 'icaoLocation'),
    schedule: optString(raw, 'schedule'),
  };
}
