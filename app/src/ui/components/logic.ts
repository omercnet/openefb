// Pure decisions behind the shared components (efb-212/Views/Components/*), kept apart from the views so they are
// unit-testable without a renderer.
import { type Theme } from '../tokens';

/** CurrencyStatus. */
export type CurrencyStatus = 'current' | 'warning' | 'expired';

export function currencyStatusText(status: CurrencyStatus): string {
  switch (status) {
    case 'current':
      return 'Current';
    case 'warning':
      return 'Expiring Soon';
    case 'expired':
      return 'Expired';
  }
}

export function currencyStatusColor(status: CurrencyStatus, t: Theme): string {
  switch (status) {
    case 'current':
      return t.ok;
    case 'warning':
      return t.caution;
    case 'expired':
      return t.warning;
  }
}

/** DataFreshness.Level, in ascending severity (Swift compares them with >= and <). */
export const FRESHNESS_LEVELS = ['unknown', 'fresh', 'old', 'expired', 'unsafe'] as const;
export type FreshnessLevel = (typeof FRESHNESS_LEVELS)[number];

const levelRank = (level: FreshnessLevel): number => FRESHNESS_LEVELS.indexOf(level);

/** DataAgeBadge.isAlert: OLD or worse. */
export const isAlertLevel = (level: FreshnessLevel): boolean => levelRank(level) >= levelRank('old');

/** DataAgeBadge body guard: `hideWhenFresh` hides everything below OLD (chart-cycle style). */
export const isDataAgeBadgeVisible = (level: FreshnessLevel, hideWhenFresh: boolean): boolean =>
  !(hideWhenFresh && !isAlertLevel(level));

export function dataAgeTint(level: FreshnessLevel, t: Theme): string {
  switch (level) {
    case 'unknown':
    case 'fresh':
      return t.secondaryText;
    case 'old':
    case 'expired':
      return t.caution;
    case 'unsafe':
      return t.warning;
  }
}

/** Alpha of the badge background: tint.opacity(isAlert ? 0.35 : 0.2). */
export const dataAgeBackgroundAlpha = (level: FreshnessLevel): number => (isAlertLevel(level) ? 0.35 : 0.2);

/** FlightCategory (raw values are lowercase). */
export type FlightCategory = 'vfr' | 'mvfr' | 'ifr' | 'lifr';

export function flightCategoryColor(category: FlightCategory, t: Theme): string {
  switch (category) {
    case 'vfr':
      return t.ok;
    case 'mvfr':
      return t.categoryMVFR;
    case 'ifr':
      return t.warning;
    case 'lifr':
      return t.categoryLIFR;
  }
}

export const flightCategoryLabel = (category: FlightCategory): string => category.toUpperCase();
export const flightCategoryAccessibilityLabel = (category: FlightCategory): string =>
  `Flight category ${flightCategoryLabel(category)}`;

/** OpacitySlider: "70%" text and "70 percent" accessibility value; Swift `Int(opacity * 100)` truncates. */
export const opacityPercent = (opacity: number): number => Math.trunc(opacity * 100);
export const opacityPercentText = (opacity: number): string => `${opacityPercent(opacity)}%`;
export const opacityAccessibilityValue = (opacity: number): string => `${opacityPercent(opacity)} percent`;
export const clampOpacity = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * One screen-reader step of the opacity slider: 10 points up or down, snapped to a whole percent so repeated steps never
 * drift (0.7 + 0.1 + 0.1 is 0.8999999999999999, which `opacityPercent` truncates to 89). Any other action does nothing.
 */
export function stepOpacity(opacity: number, action: string): number | null {
  if (action !== 'increment' && action !== 'decrement') return null;
  return clampOpacity(Math.round((opacity + (action === 'increment' ? 0.1 : -0.1)) * 100) / 100);
}

export const DATABASE_UNAVAILABLE_TITLE = 'Airport database could not be opened';
export const DATABASE_UNAVAILABLE_DETAIL = 'No airports, airspace or navaids will show. Reinstall Kanaf.';
/** Deep red so white text clears 4.5:1 (system red under white is ~3.6:1), day and night. */
export const DATABASE_UNAVAILABLE_BACKGROUND = '#B21212'; // Color(red: 0.70, green: 0.07, blue: 0.07)

/** The App Store page for "Kanaf EFB" (app 6829641724). */
export const APP_STORE_URL = 'https://apps.apple.com/app/id6829641724';
