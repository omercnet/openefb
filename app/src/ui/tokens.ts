// Port of efb-212/Core/DesignTokens.swift (Direction 2 strip): spacing, radii, type roles, strip metrics
// and the day / night palette. Values are exact copies; sizes are points (1 pt = 1 CSS px on web).
import { Platform, type TextStyle } from 'react-native';

/** 4-point spacing scale (Space). */
export const Space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 } as const;

/** Corner radius scale (Radius). */
export const Radius = { xs: 4, s: 8, m: 10, l: 14 } as const;

/** Fixed strip geometry (StripMetrics). */
export const StripMetrics = { width: 400, railWidth: 104, cell: 60, labelTracking: 1.2 } as const;

/**
 * Bundled faces under app-private aliases ("Kanaf-" + PostScript name). Not the bare PostScript names: the native
 * build also embeds these files (UIAppFonts), so useFonts skips a PostScript-named key as "already loaded" and RN
 * iOS then resolves it via the face's family. All six Archivo files share the typographic family "Archivo" and RN
 * picks by weight only, so the three 600-weight faces (SemiBold, Condensed SemiBold, ExtraCondensed SemiBold)
 * collapsed into one (iOS round 1: KSQL, KOAK and the GS / TRK / ALT readouts drew in normal-width Archivo).
 * An alias is registered by expo-font and maps to exactly one PostScript name.
 */
export const FontFiles = {
  'Kanaf-ArchivoRoman-Regular': require('../../assets/fonts/Archivo-Regular.ttf'),
  'Kanaf-ArchivoRoman-Medium': require('../../assets/fonts/Archivo-Medium.ttf'),
  'Kanaf-ArchivoRoman-SemiBold': require('../../assets/fonts/Archivo-SemiBold.ttf'),
  'Kanaf-ArchivoRoman-CondensedSemiBold': require('../../assets/fonts/Archivo-Condensed-SemiBold.ttf'),
  'Kanaf-ArchivoRoman-ExtraCondensedSemiBold': require('../../assets/fonts/Archivo-ExtraCondensed-SemiBold.ttf'),
  'Kanaf-ArchivoRoman-ExtraCondensedBold': require('../../assets/fonts/Archivo-ExtraCondensed-Bold.ttf'),
  'Kanaf-IBMPlexMono-Regular': require('../../assets/fonts/IBMPlexMono-Regular.ttf'),
  'Kanaf-IBMPlexMono-Medium': require('../../assets/fonts/IBMPlexMono-Medium.ttf'),
  'Kanaf-IBMPlexMono-SemiBold': require('../../assets/fonts/IBMPlexMono-SemiBold.ttf'),
} as const;

type Face = keyof typeof FontFiles;
/**
 * Line height in points for a face whose natural height (hhea ascent + descent) is `em` times the size: Archivo 1.088,
 * Plex Mono 1.3, SF 1.193. SwiftUI sizes a Text to its natural height rounded up to the pixel grid (0.5 pt on the 2x iPad).
 * Explicit at all because Chromium rounds ascent and descent separately. Per platform, each measured on the CI
 * simulator or emulator against the Swift reference:
 * - iOS: RN ceils to that same grid, but when an explicit line height is above the natural one it adds a baseline
 *   offset and the ceil then costs another half point (the 12.0 pt line of an 11 pt label became 12.5), which drifted
 *   every text column down. So iOS gets a height just below the natural one, which RN ceils to SwiftUI's grid line
 *   (iPad strip SSIM: map 0.9428 -> 0.9858, night 0.9483 -> 0.9856, airport 0.8209 -> 0.8853).
 * - Android: the natural height rounded to the nearest 0.5 pt, as before: every airport row then sat within 1 dp of the
 *   reference (SSIM 0.98). The iOS rule lost 1 to 2 dp on Android (airport 0.9813 -> 0.8577), so it is iOS only.
 * - react-native-web has no pixel grid and gets the rounded-up height itself.
 */
export const lineHeight = (fontSize: number, em: number) => {
  const natural = fontSize * em;
  switch (Platform.OS) {
    case 'ios':
      return Math.round((natural - 0.01) * 1000) / 1000;
    case 'web':
      return Math.ceil((natural - 0.01) * 2) / 2;
    default:
      return Math.round(natural * 2) / 2;
  }
};
const face = (fontFamily: Face, fontSize: number, extra?: TextStyle): TextStyle => ({
  fontFamily,
  fontSize,
  lineHeight: lineHeight(fontSize, fontFamily.includes('PlexMono') ? 1.3 : 1.088),
  ...extra,
});
const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

/** Type roles (TypeRole) at their Dynamic Type default sizes. `system*` are the SF roles the SwiftUI views use. */
export const Type = {
  title: face('Kanaf-ArchivoRoman-CondensedSemiBold', 34),
  identifier: face('Kanaf-ArchivoRoman-CondensedSemiBold', 20),
  sectionHeader: face('Kanaf-ArchivoRoman-SemiBold', 12),
  readout: (size: number) => face('Kanaf-ArchivoRoman-ExtraCondensedSemiBold', size, tabular),
  label: face('Kanaf-ArchivoRoman-Medium', 13),
  /** TypeRole.label.weight(.bold) on the Direct button: iOS substitutes the bundled SemiBold. */
  labelBold: face('Kanaf-ArchivoRoman-SemiBold', 13),
  value: face('Kanaf-IBMPlexMono-SemiBold', 20),
  valueSmall: face('Kanaf-IBMPlexMono-Medium', 16),
  body: face('Kanaf-ArchivoRoman-Regular', 15),
  caption: face('Kanaf-ArchivoRoman-Regular', 13),
  nextTime: face('Kanaf-ArchivoRoman-ExtraCondensedBold', 100, tabular),
  rowTime: face('Kanaf-ArchivoRoman-ExtraCondensedSemiBold', 44, tabular),
  rowIdent: face('Kanaf-ArchivoRoman-CondensedSemiBold', 28),
  stripLabel: face('Kanaf-ArchivoRoman-Medium', 11),
  data: face('Kanaf-IBMPlexMono-Regular', 15),
  dataEmphasis: face('Kanaf-IBMPlexMono-SemiBold', 15),
  // SF (system font) roles: .subheadline, .headline, .footnote semibold. SF line height 1.193 em.
  systemSubheadline: { fontSize: 15, lineHeight: lineHeight(15, 1.193) } as TextStyle,
  systemHeadline: { fontSize: 17, lineHeight: lineHeight(17, 1.193), fontWeight: '600' } as TextStyle,
  systemFootnoteSemibold: { fontSize: 13, lineHeight: lineHeight(13, 1.193), fontWeight: '600', ...tabular } as TextStyle,
} as const;

/** Letter spacing for strip labels (StripMetrics.labelTracking). */
export const tracked: TextStyle = { letterSpacing: StripMetrics.labelTracking };

export type Theme = {
  night: boolean;
  paper: string;
  paperSecondary: string;
  activeCell: string;
  rule: string;
  ink: string;
  inkSecondary: string;
  route: string;
  airspace: string;
  accent: string;
  /** Palette.accentText: the AccentColor asset, accent as text and tint (lighter than `accent` at night). */
  accentText: string;
  onAccent: string;
  ok: string;
  caution: string;
  warning: string;
  categoryMVFR: string;
  /** Color.primary / Color.secondary (iOS label / secondaryLabel). */
  primaryText: string;
  secondaryText: string;
  /** Palette.onWarning: text on a warning fill. */
  onWarning: string;
  /** Palette.cautionFill (Color.orange). */
  cautionFill: string;
  /** Palette.northMarker. */
  northMarker: string;
  /** Palette.fill: Color.secondary.opacity(0.12), i.e. 0.12 x the 0.6 secondaryLabel alpha. */
  fill: string;
  /** Palette.routeLine (map route line; the strip uses `route`). */
  routeLine: string;
  /** Palette.infoFill: accent at 15% (day) / 35% (night). */
  infoFill: string;
  categoryLIFR: string;
  /** Map layer toggle tints (Palette.layer*), >= 3:1 against the panel material. */
  layerSectional: string;
  layerAirports: string;
  layerAirspace: string;
  layerAdvisory: string;
  layerWeather: string;
  layerDiagrams: string;
};

/** Palette.accent under Increase Contrast (day only). */
export const AccentDayHighContrast = '#0C4091';

/** MapControlMetrics: square map control buttons. */
export const MapControlMetrics = { size: 60, cornerRadius: Radius.l } as const;

export const Day: Theme = {
  night: false,
  paper: '#EEF0F2',
  paperSecondary: '#E2E5E9',
  activeCell: '#FFFFFF',
  rule: '#C3C8CE',
  ink: '#14191F',
  inkSecondary: '#4A535E',
  route: '#C2168D',
  airspace: '#1B58A3',
  accent: '#1556B8',
  accentText: '#1556B8',
  onAccent: '#FFFFFF',
  ok: '#147832',
  caution: '#A55200',
  warning: '#C80014',
  categoryMVFR: '#007AFF', // systemBlue
  primaryText: '#000000',
  secondaryText: 'rgba(60,60,67,0.6)',
  onWarning: '#FFFFFF',
  cautionFill: '#FF9500', // systemOrange, light
  northMarker: '#FF9F94',
  fill: 'rgba(60,60,67,0.072)',
  routeLine: '#D100D1',
  infoFill: 'rgba(21,86,184,0.15)',
  categoryLIFR: '#CC00CC',
  layerSectional: '#007AFF', // systemBlue
  layerAirports: '#006E8C',
  layerAirspace: '#B45800',
  layerAdvisory: '#963CC8',
  layerWeather: '#147832',
  layerDiagrams: '#007882',
};

export const Night: Theme = {
  night: true,
  paper: '#0D1013',
  paperSecondary: '#232930',
  activeCell: '#161A1F',
  rule: '#2A3037',
  ink: '#C9C4BA',
  inkSecondary: '#8E9298',
  route: '#93407A',
  airspace: '#86A3CB',
  accent: '#2E4A6E',
  accentText: '#8FB4E0',
  onAccent: '#D9D9D9', // UIColor(white: 0.85)
  ok: '#30D158', // systemGreen, dark
  caution: '#FF9F0A', // systemOrange, dark
  warning: '#FF453A', // systemRed, dark
  categoryMVFR: '#8FB5E0',
  primaryText: '#FFFFFF',
  secondaryText: 'rgba(235,235,245,0.6)',
  onWarning: '#000000',
  cautionFill: '#FF9F0A', // systemOrange, dark
  northMarker: '#FF8F86',
  fill: 'rgba(235,235,245,0.072)',
  routeLine: '#F26BF2',
  infoFill: 'rgba(46,74,110,0.35)',
  categoryLIFR: '#E673E6',
  layerSectional: '#4678BE',
  layerAirports: '#64D2FF', // systemCyan, dark
  layerAirspace: '#FF9F0A', // systemOrange, dark
  layerAdvisory: '#BF5AF2', // systemPurple, dark
  layerWeather: '#30D158', // systemGreen, dark
  layerDiagrams: '#6AC4DC', // systemTeal, dark
};
