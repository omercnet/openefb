// Look of the grouped forms (SwiftUI Form / List on iOS: inset grouped cards, system text styles). The Swift screens use the
// system font and the system text styles, not the strip's Archivo faces, so these roles reuse tokens.ts's SF line heights.
import type { TextStyle } from 'react-native';
import { lineHeight, type Theme } from '../tokens';

const sf = (fontSize: number, extra?: TextStyle): TextStyle => ({
  fontSize,
  lineHeight: lineHeight(fontSize, 1.193),
  ...extra,
});

/** The SwiftUI text styles at their default Dynamic Type sizes. */
export const FormType = {
  largeTitle: sf(34, { fontWeight: '700' }),
  /** The +/- glyphs of a stepper (.title2). */
  title2: sf(22),
  headline: sf(17, { fontWeight: '600' }),
  body: sf(17),
  subheadline: sf(15),
  footnote: sf(13),
  caption: sf(12),
} as const;

export const FormMetrics = {
  /** Minimum row height (also the touch target). iOS 26 rows are about 52 pt tall at the default text size. */
  row: 52,
  /** Card inset from the screen edge, and the text inset inside a row: section headers and footers align with row text. */
  margin: 20,
  pad: 20,
  /** Corner radius of a section card (iOS 26 grouped lists are strongly rounded). */
  radius: 26,
} as const;

/** Palette.accentText: the AccentColor asset (day = accent, night = a light blue that reads on dark paper). */
export const accentText = (t: Theme): string => (t.night ? '#8FB4DF' : t.accent);

export type Tone = 'primary' | 'secondary' | 'accent' | 'ok' | 'caution' | 'warning';

export function toneColor(t: Theme, tone: Tone): string {
  switch (tone) {
    case 'primary':
      return t.primaryText;
    case 'secondary':
      return t.secondaryText;
    case 'accent':
      return accentText(t);
    case 'ok':
      return t.ok;
    case 'caution':
      return t.caution;
    case 'warning':
      return t.warning;
  }
}
