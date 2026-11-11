// Port of the d-TPP models and pure helpers in TerminalProcedureService.swift: chart categories, the 28-day cycle
// arithmetic, the APRA info parser and the metafile parser. Times are epoch ms (UTC).
import { AppFailure } from '../../domain/errors';
import { parseXml, XmlError, type XmlHandler } from './xml';

export const DTPP_REGION = 'FAA terminal procedures';

/** Grouping used by the airport sheet, in display order. */
export const TERMINAL_CHART_CATEGORIES = ['diagram', 'approach', 'departure', 'arrival', 'minimums', 'other'] as const;
export type TerminalChartCategory = (typeof TERMINAL_CHART_CATEGORIES)[number];

/** Maps a d-TPP `chart_code` (APD, IAP, DP, ODP, STR, MIN, HOT, LAH, DAU, ...) to a category. */
export function categoryForChartCode(chartCode: string): TerminalChartCategory {
  switch (chartCode.replace(/^[ \t]+|[ \t]+$/g, '').toUpperCase()) {
    case 'APD':
      return 'diagram';
    case 'IAP':
      return 'approach';
    case 'DP':
    case 'ODP':
      return 'departure';
    case 'STR':
    case 'STAR':
      return 'arrival';
    case 'MIN':
      return 'minimums';
    default:
      return 'other'; // HOT (hot spots), LAH (land and hold short), DAU, ...
  }
}

const CATEGORY_TITLES: Record<TerminalChartCategory, string> = {
  diagram: 'Airport Diagram',
  approach: 'Approaches',
  departure: 'Departures',
  arrival: 'Arrivals',
  minimums: 'Minimums',
  other: 'Other',
};
export const categoryTitle = (c: TerminalChartCategory): string => CATEGORY_TITLES[c];

/** One terminal procedure chart (one PDF) from the d-TPP metafile. */
export interface TerminalChart {
  chartCode: string; // d-TPP chart_code, e.g. "APD", "IAP"
  name: string; // d-TPP chart_name, e.g. "RNAV (GPS) RWY 31"
  pdfName: string; // d-TPP pdf_name, e.g. "09216AD.PDF"
  cycle: string; // YYNN, e.g. "2611"
  category: TerminalChartCategory;
}

export function makeTerminalChart(chartCode: string, name: string, pdfName: string, cycle: string): TerminalChart {
  return { chartCode, name, pdfName, cycle, category: categoryForChartCode(chartCode) };
}

/** Several records can share a PDF (e.g. TAKEOFF MINIMUMS and DIVERSE VECTOR AREA), so the name is part of the id. */
export const terminalChartId = (c: TerminalChart): string => `${c.cycle}/${c.pdfName}/${c.name}`;

/** Groups charts by category in display order (diagram first), keeping metafile order within a group. Port of
 * AirportChartsSection.grouped (the view itself is M4). */
export function groupCharts(
  charts: readonly TerminalChart[],
): { category: TerminalChartCategory; charts: TerminalChart[] }[] {
  return TERMINAL_CHART_CATEGORIES.map((category) => ({
    category,
    charts: charts.filter((c) => c.category === category),
  })).filter((g) => g.charts.length > 0);
}

/** A 28-day d-TPP publication cycle. Charts become effective at 0901Z on the effective date. */
export interface DTPPCycle {
  code: string; // YYNN, e.g. "2611"
  effectiveMs: number; // 0901Z on the first day of the cycle
  expirationMs: number; // 0901Z on the first day of the next cycle
}

export const cycleIsExpired = (c: DTPPCycle, nowMs: number): boolean => nowMs >= c.expirationMs;
export const cycleIsCurrent = (c: DTPPCycle, nowMs: number): boolean =>
  nowMs >= c.effectiveMs && nowMs < c.expirationMs;

/** Compact per-airport chart index distilled from the d-TPP metafile. */
export interface DTPPIndex {
  cycle: DTPPCycle;
  /** Keyed by ICAO ident, or FAA ident when the airport has no ICAO ident. */
  airports: Record<string, TerminalChart[]>;
  /** FAA ident (apt_ident) -> key in `airports`. */
  faaIdents: Record<string, string>;
}

const own = <T>(o: Record<string, T>, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined;

/** Matches on ICAO ident first, then FAA ident. */
export function indexCharts(index: DTPPIndex, icao: string, faaID: string | null | undefined): TerminalChart[] {
  const key = icao.toUpperCase();
  const direct = own(index.airports, key);
  if (direct) return direct;
  for (const ident of [faaID?.toUpperCase(), key]) {
    if (ident === undefined) continue;
    const mapped = own(index.faaIdents, ident);
    const charts = mapped === undefined ? undefined : own(index.airports, mapped);
    if (charts) return charts;
  }
  return [];
}

/** YYNN cycle codes sort chronologically. */
export const isCycleCode = (s: string): boolean => /^[0-9]{4}$/.test(s);

/** 28 days in ms. */
export const CYCLE_LENGTH_MS = 28 * 86_400_000;

/** d-TPP cycle 2001 became effective 2020-01-02 at 0901Z; every cycle since is exactly 28 days. */
export const REFERENCE_EFFECTIVE_MS = Date.UTC(2020, 0, 2, 9, 1);

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Computes the 28-day cycle containing `ms`. Code is YYNN where NN is the cycle's ordinal within the year its effective
 * date falls in (e.g. 10/29/2026 -> "2611"). */
export function cycleContaining(ms: number): DTPPCycle {
  const elapsed = Math.floor((ms - REFERENCE_EFFECTIVE_MS) / CYCLE_LENGTH_MS);
  const effective = REFERENCE_EFFECTIVE_MS + elapsed * CYCLE_LENGTH_MS;
  const year = new Date(effective).getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const firstOfYear = Math.ceil((jan1 - REFERENCE_EFFECTIVE_MS) / CYCLE_LENGTH_MS);
  const number = elapsed - firstOfYear + 1;
  return {
    code: `${pad2(((year % 100) + 100) % 100)}${pad2(number)}`,
    effectiveMs: effective,
    expirationMs: effective + CYCLE_LENGTH_MS,
  };
}

/** The cycle with `code` (YYNN) among the cycles within a year of `ms`; null for an unknown code. Used to date a chart from
 * its own cycle, not from the newest cycle the device happens to know. */
export function cycleWithCode(code: string, nearMs: number): DTPPCycle | null {
  for (let offset = -13; offset <= 13; offset++) {
    const candidate = cycleContaining(nearMs + offset * CYCLE_LENGTH_MS);
    if (candidate.code === code) return candidate;
  }
  return null;
}

const corrupted = () => new AppFailure({ kind: 'chartCorrupted', region: DTPP_REGION });

/** Parses the FAA APRA `dtpp/info` JSON:
 * `{"edition":[{"editionName":"CURRENT","editionDate":"10/29/2026","editionNumber":11}]}`. */
export function parseCycleInfo(body: string): DTPPCycle {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw corrupted();
  }
  const root =
    typeof json === 'object' && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  const editions = root?.edition;
  if (!Array.isArray(editions) || !editions.every((e) => typeof e === 'object' && e !== null && !Array.isArray(e)))
    throw corrupted();
  const list = editions as Record<string, unknown>[];
  const edition =
    list.find((e) => typeof e.editionName === 'string' && e.editionName.toUpperCase() === 'CURRENT') ?? list[0];
  const rawNumber = edition?.editionNumber;
  let number: number | null = null;
  if (typeof rawNumber === 'number' && Number.isInteger(rawNumber)) number = rawNumber;
  else if (typeof rawNumber === 'string' && /^[+-]?[0-9]+$/.test(rawNumber)) number = parseInt(rawNumber, 10);

  const dateString = edition?.editionDate;
  const m = typeof dateString === 'string' ? /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(dateString) : null;
  if (number === null || number < 1 || number > 14 || !m) throw corrupted();
  const [month, day, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dayMs = Date.UTC(year, month - 1, day);
  const check = new Date(dayMs);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day)
    throw corrupted();
  const effective = dayMs + 9 * 3_600_000 + 60_000; // 0901Z
  const effectiveYear = new Date(effective).getUTCFullYear();
  return {
    code: `${pad2(effectiveYear % 100)}${pad2(number)}`,
    effectiveMs: effective,
    expirationMs: effective + CYCLE_LENGTH_MS,
  };
}

/** Parses metafile dates like `"0901Z  10/29/26"` (UTC). Two-digit years are 20xx. */
export function parseMetafileDate(text: string): number | null {
  const normalized = text
    .split(/\s+/)
    .filter((s) => s !== '')
    .join(' ');
  const m = /^(\d{2})(\d{2})Z (\d{2})\/(\d{2})\/(\d{2})$/.exec(normalized);
  if (!m) return null;
  const [hour, minute, month, day, yy] = m.slice(1).map(Number);
  if (hour > 23 || minute > 59) return null;
  const year = 2000 + yy;
  const ms = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return ms;
}

interface MetafileRecord {
  code: string;
  name: string;
  pdf: string;
  action: string;
}

/** Skips deleted records (useraction D, DELETED_JOB.PDF) and anything that isn't a PDF. */
function isLive(r: MetafileRecord): boolean {
  const pdf = r.pdf.toUpperCase();
  return r.action.toUpperCase() !== 'D' && pdf.endsWith('.PDF') && !pdf.startsWith('DELETED') && r.code !== '';
}

/** Parses the metafile, keeping only chart records that point at a live PDF. SAX delegate for
 * `<digital_tpp cycle from_edate to_edate>` > `<state_code>` > `<city_name>` > `<airport_name apt_ident icao_ident>` >
 * `<record>` { chart_code, chart_name, useraction, pdf_name }. Throws AppFailure(chartCorrupted) for malformed input. */
export function parseMetafile(xml: string, fallbackCycle: DTPPCycle | null = null): DTPPIndex {
  let cycleCode: string | null = null;
  let fromDate: string | null = null;
  let toDate: string | null = null;
  const airports: Record<string, MetafileRecord[]> = Object.create(null) as Record<string, MetafileRecord[]>;
  const faaIdents: Record<string, string> = Object.create(null) as Record<string, string>;
  let airportKey: string | null = null;
  let record: MetafileRecord | null = null;
  let text = '';

  const handler: XmlHandler = {
    start(name, attributes) {
      text = '';
      if (name === 'digital_tpp') {
        cycleCode = (attributes.cycle ?? '').replace(/^[ \t]+|[ \t]+$/g, '');
        if (attributes.cycle === undefined) cycleCode = null;
        fromDate = attributes.from_edate ?? null;
        toDate = attributes.to_edate ?? null;
      } else if (name === 'airport_name') {
        const icao = (attributes.icao_ident ?? '').trim().toUpperCase();
        const faa = (attributes.apt_ident ?? '').trim().toUpperCase();
        const key = icao === '' ? faa : icao;
        airportKey = key === '' ? null : key;
        if (faa !== '' && key !== '') faaIdents[faa] = key;
      } else if (name === 'record') {
        record = { code: '', name: '', pdf: '', action: '' };
      }
    },
    text(chunk) {
      if (record !== null) text += chunk;
    },
    end(name) {
      const value = text.trim();
      switch (name) {
        case 'chart_code':
          if (record) record.code = value;
          break;
        case 'chart_name':
          if (record) record.name = value;
          break;
        case 'pdf_name':
          if (record) record.pdf = value;
          break;
        case 'useraction':
          if (record) record.action = value;
          break;
        case 'record':
          if (record && airportKey !== null && isLive(record)) (airports[airportKey] ??= []).push(record);
          record = null;
          break;
        case 'airport_name':
          airportKey = null;
          break;
      }
      text = '';
    },
  };

  try {
    parseXml(xml, handler);
  } catch (error) {
    if (error instanceof XmlError) throw new AppFailure({ kind: 'chartCorrupted', region: error.message });
    throw error;
  }

  const code = cycleCode ?? fallbackCycle?.code ?? null;
  if (code === null || !isCycleCode(code)) throw corrupted();
  const computed = fallbackCycle?.code === code ? fallbackCycle : null;
  const effective = (fromDate !== null ? parseMetafileDate(fromDate) : null) ?? computed?.effectiveMs ?? null;
  const expiration = (toDate !== null ? parseMetafileDate(toDate) : null) ?? computed?.expirationMs ?? null;
  if (effective === null || expiration === null) throw corrupted();

  const out: Record<string, TerminalChart[]> = Object.create(null) as Record<string, TerminalChart[]>;
  for (const [key, records] of Object.entries(airports)) {
    out[key] = records.map((r) => makeTerminalChart(r.code, r.name, r.pdf, code));
  }
  return { cycle: { code, effectiveMs: effective, expirationMs: expiration }, airports: out, faaIdents };
}

// MARK: Persisted form

/** JSON of a DTPPIndex as saved under <cycle>/index.json. */
export const encodeIndex = (index: DTPPIndex): string => JSON.stringify(index);

/** Decodes a saved index; null for anything unreadable. Categories are re-derived from the chart code. */
export function decodeIndex(body: string): DTPPIndex | null {
  try {
    const o = JSON.parse(body) as Record<string, unknown>;
    const cycle = o.cycle as Record<string, unknown>;
    if (
      typeof cycle.code !== 'string' ||
      typeof cycle.effectiveMs !== 'number' ||
      typeof cycle.expirationMs !== 'number'
    )
      return null;
    const airports: Record<string, TerminalChart[]> = Object.create(null) as Record<string, TerminalChart[]>;
    for (const [key, charts] of Object.entries(o.airports as Record<string, unknown>)) {
      if (!Array.isArray(charts)) return null;
      airports[key] = charts.map((c: Record<string, unknown>) => {
        if (
          typeof c.chartCode !== 'string' ||
          typeof c.name !== 'string' ||
          typeof c.pdfName !== 'string' ||
          typeof c.cycle !== 'string'
        ) {
          throw new Error('bad chart');
        }
        return makeTerminalChart(c.chartCode, c.name, c.pdfName, c.cycle);
      });
    }
    const faaIdents: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const [k, v] of Object.entries(o.faaIdents as Record<string, unknown>)) {
      if (typeof v !== 'string') return null;
      faaIdents[k] = v;
    }
    return {
      cycle: { code: cycle.code, effectiveMs: cycle.effectiveMs, expirationMs: cycle.expirationMs },
      airports,
      faaIdents,
    };
  } catch {
    return null;
  }
}
