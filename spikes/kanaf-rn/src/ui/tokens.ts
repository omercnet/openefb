// Port of efb-212/Core/DesignTokens.swift (Direction 2 strip): spacing, radii, type roles, strip metrics
// and the day / night palette. Values are exact copies; sizes are points (1 pt = 1 CSS px on web).
import type { TextStyle } from 'react-native';

/** 4-point spacing scale (Space). */
export const Space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 } as const;

/** Corner radius scale (Radius). */
export const Radius = { xs: 4, s: 8, m: 10, l: 14 } as const;

/** Fixed strip geometry (StripMetrics). */
export const StripMetrics = { width: 400, railWidth: 104, cell: 60, labelTracking: 1.2 } as const;

/** Bundled faces, keyed by PostScript name so iOS resolves the same face the SwiftUI app registers. */
export const FontFiles = {
  'ArchivoRoman-Regular': require('../../assets/fonts/Archivo-Regular.ttf'),
  'ArchivoRoman-Medium': require('../../assets/fonts/Archivo-Medium.ttf'),
  'ArchivoRoman-SemiBold': require('../../assets/fonts/Archivo-SemiBold.ttf'),
  'ArchivoRoman-CondensedSemiBold': require('../../assets/fonts/Archivo-Condensed-SemiBold.ttf'),
  'ArchivoRoman-ExtraCondensedSemiBold': require('../../assets/fonts/Archivo-ExtraCondensed-SemiBold.ttf'),
  'ArchivoRoman-ExtraCondensedBold': require('../../assets/fonts/Archivo-ExtraCondensed-Bold.ttf'),
  'IBMPlexMono-Regular': require('../../assets/fonts/IBMPlexMono-Regular.ttf'),
  'IBMPlexMono-Medium': require('../../assets/fonts/IBMPlexMono-Medium.ttf'),
  'IBMPlexMono-SemiBold': require('../../assets/fonts/IBMPlexMono-SemiBold.ttf'),
} as const;

type Face = keyof typeof FontFiles;
// Natural line height (hhea ascent + descent, em): Archivo 0.878 + 0.210, Plex Mono 1.025 + 0.275. Set explicitly
// because Chromium rounds ascent and descent separately (15pt Plex: 19 instead of 19.5) and the rows drift.
const lineEm = (f: Face) => (f.startsWith('IBMPlexMono') ? 1.3 : 1.088);
const face = (fontFamily: Face, fontSize: number, extra?: TextStyle): TextStyle => ({
  fontFamily,
  fontSize,
  lineHeight: fontSize * lineEm(fontFamily),
  ...extra,
});
const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

/** Type roles (TypeRole) at their Dynamic Type default sizes. `system*` are the SF roles the SwiftUI views use. */
export const Type = {
  title: face('ArchivoRoman-CondensedSemiBold', 34),
  identifier: face('ArchivoRoman-CondensedSemiBold', 20),
  sectionHeader: face('ArchivoRoman-SemiBold', 12),
  readout: (size: number) => face('ArchivoRoman-ExtraCondensedSemiBold', size, tabular),
  label: face('ArchivoRoman-Medium', 13),
  value: face('IBMPlexMono-SemiBold', 20),
  valueSmall: face('IBMPlexMono-Medium', 16),
  body: face('ArchivoRoman-Regular', 15),
  caption: face('ArchivoRoman-Regular', 13),
  nextTime: face('ArchivoRoman-ExtraCondensedBold', 100, tabular),
  rowTime: face('ArchivoRoman-ExtraCondensedSemiBold', 44, tabular),
  rowIdent: face('ArchivoRoman-CondensedSemiBold', 28),
  stripLabel: face('ArchivoRoman-Medium', 11),
  data: face('IBMPlexMono-Regular', 15),
  dataEmphasis: face('IBMPlexMono-SemiBold', 15),
  // SF (system font) roles: .subheadline, .headline, .footnote semibold. SF line height 1.193 em.
  systemSubheadline: { fontSize: 15, lineHeight: 17.9 } as TextStyle,
  systemHeadline: { fontSize: 17, lineHeight: 20.3, fontWeight: '600' } as TextStyle,
  systemFootnoteSemibold: { fontSize: 13, lineHeight: 15.5, fontWeight: '600', ...tabular } as TextStyle,
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
  onAccent: string;
  ok: string;
  caution: string;
  warning: string;
  categoryMVFR: string;
  /** Color.primary / Color.secondary (iOS label / secondaryLabel). */
  primaryText: string;
  secondaryText: string;
};

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
  onAccent: '#FFFFFF',
  ok: '#147832',
  caution: '#A55200',
  warning: '#C80014',
  categoryMVFR: '#007AFF', // systemBlue
  primaryText: '#000000',
  secondaryText: 'rgba(60,60,67,0.6)',
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
  onAccent: '#D9D9D9', // UIColor(white: 0.85)
  ok: '#30D158', // systemGreen, dark
  caution: '#FF9F0A', // systemOrange, dark
  warning: '#FF453A', // systemRed, dark
  categoryMVFR: '#8FB5E0',
  primaryText: '#FFFFFF',
  secondaryText: 'rgba(235,235,245,0.6)',
};
