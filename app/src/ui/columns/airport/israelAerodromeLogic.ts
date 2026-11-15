// The text of IsraelAerodromeSection (efb-212/Views/Map/IsraelAerodromeSection.swift), as pure functions.
import {
  runwayLengthFeet,
  type IsraelAerodrome,
  type IsraelAerodromeRunway,
  type IsraelAerodromeUse,
} from '../../../data/aviation/israelTypes';
import { capitalized } from './logic';

export const isReviewed = (a: Pick<IsraelAerodrome, 'reviewStatus'>): boolean => a.reviewStatus === 'reviewed';

export function groupLabel(group: string): string {
  switch (group) {
    case 'elevation_ft':
      return 'elevation';
    case 'identity':
      return 'position';
    default:
      return group;
  }
}

export function useNote(use: IsraelAerodromeUse): string | null {
  switch (use) {
    case 'civil':
      return null;
    case 'military':
      return 'Military field: operation needs CAAI authorization';
    case 'uas':
      return 'Unmanned-aircraft strip: no manned landings without CAAI approval';
    case 'agricultural':
      return 'Agricultural strip: coordinate with the operator';
    case 'hospital':
      return 'Hospital helipad: coordinate with the hospital';
    case 'foreign':
      return 'Outside Israel: shown for orientation only';
    case 'ultralight':
      return 'Ultralight strip: not for conventional GA aircraft';
  }
}

export function pprText(a: Pick<IsraelAerodrome, 'ppr' | 'pprText'>): string {
  const note = a.pprText !== null ? `. ${a.pprText}` : '';
  switch (a.ppr) {
    case 'yes':
      return `Required${note}`;
    case 'no':
      return `Not required${note}`;
    case 'unknown':
      return a.pprText ?? 'Not stated in the AIP';
  }
}

/** Swift `String(format: "%g")` for a non-integer: up to six significant digits, no trailing zeros. */
export function number(value: number): string {
  return Math.round(value) === value ? String(Math.round(value)) : String(Number(value.toPrecision(6)));
}

/** "903 x 18 m  (2963 ft)": metres as the AIP gives them, the length also in feet. */
export const dimensions = (r: IsraelAerodromeRunway): string =>
  `${number(r.lengthMetres)} x ${number(r.widthMetres)} m  (${runwayLengthFeet(r)} ft)`;

export function surfaceAndHeading(r: IsraelAerodromeRunway): string {
  const parts = [r.surface === 'unknown' ? 'surface not published' : capitalized(r.surface)];
  if (r.headingA !== null && r.headingB !== null && r.headingIsTrue !== null) {
    parts.push(`${number(r.headingA)}/${number(r.headingB)}\u00B0 ${r.headingIsTrue ? 'true' : 'magnetic'}`);
  }
  return parts.join(', ');
}

export const spoken = (r: IsraelAerodromeRunway): string =>
  `${number(r.lengthMetres)} by ${number(r.widthMetres)} metres, ${surfaceAndHeading(r)}`;

export const circuitText = (a: Pick<IsraelAerodrome, 'circuitAltitudeFeet' | 'circuitDirection'>): string | null =>
  a.circuitAltitudeFeet === null
    ? null
    : `${a.circuitAltitudeFeet}' MSL${a.circuitDirection !== null ? `, ${a.circuitDirection}` : ''}`;

export const UNREVIEWED_TEXT =
  'Taken from the AIP and not yet checked by a person against the current publication. Verify before flight.';
