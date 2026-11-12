// Port of Services/IsraelChartStyle.swift as data: the day and night palettes, the label kinds (colour and size) and the
// point symbol kinds. Swift rendered labels and symbols to UIKit sprites; here labels are MapLibre text symbols and
// symbols are circles (see ./layers and docs/port-notes/M1-israel.md). Colour rules (COMMON.md): red = warning,
// amber = caution. Red only for NOTAM route closures; P/R/D areas are amber; airspace indigo; civil routes green;
// military routes blue. Hex values are the Swift UIColor components rounded to 8 bits.
import type { IsraelAerodromeType, IsraelPointKind } from '../../../data/aviation/israelTypes';

export interface IsraelChartPalette {
  civilRoute: string;
  militaryRoute: string;
  airspace: string;
  restricted: string;
  closure: string;
  runway: string;
  symbol: string;
  labelText: string;
  labelHalo: string;
  altitudeText: string;
  militaryText: string;
  closureText: string;
  /** Fill opacity for airspace areas (light: the base map must show through). */
  airspaceFillOpacity: number;
}

export const ISRAEL_DAY_PALETTE: IsraelChartPalette = {
  civilRoute: '#0D7833',
  militaryRoute: '#1447C7',
  airspace: '#5733AD',
  restricted: '#A55200', // Palette.caution (day)
  closure: '#C80014', // Palette.warning (day)
  runway: '#1F1F1F',
  symbol: '#0A144C',
  labelText: '#141414',
  labelHalo: 'rgba(255, 255, 255, 0.92)',
  altitudeText: '#055421',
  militaryText: '#0D33A6',
  closureText: '#C80014',
  airspaceFillOpacity: 0.07,
};

/** Night: about 55% luminance foregrounds, dark halos. systemOrange/systemRed resolved to their dark variants. */
export const ISRAEL_NIGHT_PALETTE: IsraelChartPalette = {
  civilRoute: '#479461',
  militaryRoute: '#5C85D6',
  airspace: '#9475D1',
  restricted: 'rgba(255, 159, 10, 0.85)', // systemOrange (dark) at 0.85
  closure: '#FF453A', // systemRed (dark)
  runway: '#9E9E9E',
  symbol: '#A8B8E6',
  labelText: '#BDBDBD',
  labelHalo: 'rgba(10, 10, 10, 0.9)',
  altitudeText: '#85CC99',
  militaryText: '#99B8F2',
  closureText: '#FF453A',
  airspaceFillOpacity: 0.1,
};

export const israelPalette = (night: boolean): IsraelChartPalette =>
  night ? ISRAEL_NIGHT_PALETTE : ISRAEL_DAY_PALETTE;

/** The kinds of label (Swift sprite kinds). Each has a colour and size; the text varies. */
export type IsraelChartLabelKind =
  'altitude' | 'altitudeMilitary' | 'pointCode' | 'airspace' | 'airspaceRestricted' | 'closure' | 'closureCaution';

export function labelColor(kind: IsraelChartLabelKind, p: IsraelChartPalette): string {
  switch (kind) {
    case 'altitude':
      return p.altitudeText;
    case 'altitudeMilitary':
      return p.militaryText;
    case 'pointCode':
      return p.labelText;
    case 'airspace':
      return p.airspace;
    case 'airspaceRestricted':
      return p.restricted;
    case 'closure':
      return p.closureText;
    case 'closureCaution':
      return p.restricted; // amber: partial closures and "check NOTAM"
  }
}

/** Point size. Altitude labels are the working numbers of a CVFR flight, so the largest. */
export const LABEL_FONT_SIZE: Record<IsraelChartLabelKind, number> = {
  altitude: 12,
  altitudeMilitary: 12,
  closure: 12,
  closureCaution: 12,
  pointCode: 11,
  airspace: 10.5,
  airspaceRestricted: 10.5,
};

/** Point symbols (Swift IsraelChartSymbol; sprite names were "il-sym-<kind>"), kept as the feature `symbol` property. */
export type IsraelChartSymbol = 'compulsory' | 'onRequest' | 'aerodrome' | 'airstrip' | 'heliport';

export const symbolForPointKind = (kind: IsraelPointKind): IsraelChartSymbol =>
  kind === 'compulsory' ? 'compulsory' : kind === 'arp' ? 'aerodrome' : 'onRequest';

export const symbolForAerodromeType = (type: IsraelAerodromeType): IsraelChartSymbol =>
  type === 'airport' ? 'aerodrome' : type;
