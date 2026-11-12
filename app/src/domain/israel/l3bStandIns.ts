// Local stand-ins for the Services/IsraelChartFeatures.swift (M1) pieces the alert evaluator needs:
// IsraelChartClosureMark and limitText/limitsText. Faithful ports, so behaviour does not change when M1 lands and
// these are replaced by that port's exports.
import type { IsraelAirspaceLimit } from '../../data/aviation/israelTypes';
import type { IsraelClosureSeverity } from './notamTypes';

/** A NOTAM closure applied to a segment (IsraelChartClosureMark). */
export interface IsraelChartClosureMark {
  notamID: string;
  /** "CLSD to 13:30Z"; partial closures carry their altitudes; unread ones say "CHECK NOTAM". */
  text: string;
  schedule: string | null;
  severity: IsraelClosureSeverity;
  notes: string[];
}

/** One vertical limit as chart text: "SFC", "UNL", "FL95", "3000", or the published two-number text. */
export function limitText(limit: IsraelAirspaceLimit): string | null {
  if (limit.publishedText !== null && limit.publishedText !== '') return limit.publishedText;
  switch (limit.reference) {
    case 'SFC':
      return 'SFC';
    case 'UNL':
      return 'UNL';
    case 'FL':
      return limit.feet === null ? 'FL' : `FL${Math.trunc(limit.feet / 100)}`;
    case 'AGL':
      return limit.feet === null ? null : `${limit.feet} AGL`;
    default:
      if (limit.feet === null) return null;
      return limit.feet === 0 ? 'SFC' : String(limit.feet);
  }
}

/** "SFC–3000"; "" when neither limit is published. */
export function limitsText(floor: IsraelAirspaceLimit, ceiling: IsraelAirspaceLimit): string {
  const f = limitText(floor);
  const c = limitText(ceiling);
  if (f !== null && c !== null) return `${f}\u2013${c}`;
  if (f !== null) return `${f}\u2013?`;
  if (c !== null) return `?\u2013${c}`;
  return '';
}
