// No Swift tests cover Views/Components; these pin the decisions read from the Swift sources.
import { Day, Night } from '../tokens';
import {
  clampOpacity,
  currencyStatusColor,
  currencyStatusText,
  dataAgeBackgroundAlpha,
  dataAgeTint,
  flightCategoryAccessibilityLabel,
  flightCategoryColor,
  isAlertLevel,
  isDataAgeBadgeVisible,
  opacityAccessibilityValue,
  opacityPercentText,
} from './logic';

describe('CurrencyBadge', () => {
  it('words and colours per status', () => {
    expect(['current', 'warning', 'expired'].map((s) => currencyStatusText(s as 'current'))).toEqual([
      'Current',
      'Expiring Soon',
      'Expired',
    ]);
    expect(currencyStatusColor('current', Day)).toBe(Day.ok);
    expect(currencyStatusColor('warning', Night)).toBe(Night.caution);
    expect(currencyStatusColor('expired', Day)).toBe(Day.warning);
  });
});

describe('DataAgeBadge', () => {
  it('alerts from OLD upward', () => {
    expect(['unknown', 'fresh', 'old', 'expired', 'unsafe'].map((l) => isAlertLevel(l as 'old'))).toEqual([
      false,
      false,
      true,
      true,
      true,
    ]);
  });
  it('hiddenWhenFresh hides below OLD only', () => {
    expect(isDataAgeBadgeVisible('fresh', true)).toBe(false);
    expect(isDataAgeBadgeVisible('unknown', true)).toBe(false);
    expect(isDataAgeBadgeVisible('old', true)).toBe(true);
    expect(isDataAgeBadgeVisible('fresh', false)).toBe(true);
  });
  it('tint and background alpha', () => {
    expect(dataAgeTint('fresh', Day)).toBe(Day.secondaryText);
    expect(dataAgeTint('expired', Day)).toBe(Day.caution);
    expect(dataAgeTint('unsafe', Night)).toBe(Night.warning);
    expect(dataAgeBackgroundAlpha('fresh')).toBe(0.2);
    expect(dataAgeBackgroundAlpha('old')).toBe(0.35);
  });
});

describe('FlightCategoryDot', () => {
  it('colours and label', () => {
    expect(flightCategoryColor('vfr', Day)).toBe(Day.ok);
    expect(flightCategoryColor('mvfr', Night)).toBe(Night.categoryMVFR);
    expect(flightCategoryColor('ifr', Day)).toBe(Day.warning);
    expect(flightCategoryColor('lifr', Night)).toBe(Night.categoryLIFR);
    expect(flightCategoryAccessibilityLabel('lifr')).toBe('Flight category LIFR');
  });
});

describe('OpacitySlider', () => {
  it('truncates like Int(opacity * 100)', () => {
    expect(opacityPercentText(0.7)).toBe('70%');
    expect(opacityPercentText(0.999)).toBe('99%');
    expect(opacityAccessibilityValue(0.5)).toBe('50 percent');
    expect(clampOpacity(1.4)).toBe(1);
    expect(clampOpacity(-0.2)).toBe(0);
  });
});
