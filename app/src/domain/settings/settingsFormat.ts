// Small rules from SettingsView.swift that are not wiring: how dates, the airport-data cycle and the "to renew" count read.
import type { PilotProfile } from '../../data/models';
import type { AviationDataCycle } from '../../data/aviation/types';
import { flightReviewStatus, medicalStatus, nightCurrencyStatus } from '../currency';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** OfflineMapsView.dateString: "d MMM yyyy" in UTC with the en_US_POSIX locale. 'unknown' for a value that is not a time. */
export function formatCycleDate(epochMs: number): string {
  const d = new Date(epochMs);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).padStart(4, '0')}`;
}

export interface AviationDataRow {
  text: string;
  /** Shown in the warning colour: out-of-date data must not read as current. */
  expired: boolean;
}

/** SettingsView.aviationDataRow: the NASR cycle of the bundled airport database, red once it has lapsed. */
export function aviationDataRow(cycle: AviationDataCycle | null, now: number): AviationDataRow {
  if (cycle === null || !Number.isFinite(cycle.effectiveMs) || !Number.isFinite(cycle.expiresMs)) {
    return { text: 'Cycle unknown', expired: false };
  }
  const expired = now >= cycle.expiresMs;
  const text = `NASR ${formatCycleDate(cycle.effectiveMs)}, ${expired ? 'EXPIRED' : 'valid to'} ${formatCycleDate(cycle.expiresMs)}`;
  return { text, expired };
}

/**
 * SettingsView.currencyCount: how many of medical, flight review and night currency are not current for the active pilot.
 * Shown on the Aircraft & Pilot row as "N to renew".
 */
export function currencyToRenewCount(pilot: PilotProfile | null, now: number): number {
  if (pilot === null) return 0;
  const statuses = [
    medicalStatus(pilot.medicalExpiry, now),
    flightReviewStatus(pilot.flightReviewDate, now),
    nightCurrencyStatus(pilot.nightLandingEntries, now),
  ];
  return statuses.filter((s) => s !== 'current').length;
}

const SIZE_UNITS = ['KB', 'MB', 'GB', 'TB', 'PB'];
const fractionDigits = (unit: number): number => (unit === 0 ? 0 : unit === 1 ? 1 : 2);

/**
 * Stand-in for OfflineSizeFormatter.string (ByteCountFormatter, .file style: decimal units, adaptive digits, no zero
 * padding). The offline-maps ticket (M3) owns the real one; Settings takes the formatter as a dependency.
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Zero KB';
  if (bytes < 1000) return bytes === 1 ? '1 byte' : `${Math.trunc(bytes)} bytes`;
  let value = bytes / 1000;
  let unit = 0;
  while (Number(value.toFixed(fractionDigits(unit))) >= 1000 && unit < SIZE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${Number(value.toFixed(fractionDigits(unit)))} ${SIZE_UNITS[unit]}`;
}
