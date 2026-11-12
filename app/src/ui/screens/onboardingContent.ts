// The copy of Views/Onboarding/OnboardingView.swift. onboardingContent.test.ts reads the Swift view and asserts it is verbatim.
import { ONBOARDING_SUMMARY, PRIMARY_NAVIGATION } from '../../domain/disclaimers';

export interface OnboardingRowContent {
  icon: 'map' | 'cloudSlash' | 'shield';
  /** Palette.accentText, or Palette.caution for the disclaimer row. */
  tone: 'accent' | 'caution';
  title: string;
  text: string;
}

export const ONBOARDING_TITLE = 'Kanaf';
export const ONBOARDING_ACTION = 'I understand';

export const ONBOARDING_ROWS: readonly OnboardingRowContent[] = [
  {
    icon: 'map',
    tone: 'accent',
    title: 'See where you are',
    text: 'Your position on the FAA sectional, with airspace, airports, TFRs and METARs around you.',
  },
  {
    icon: 'cloudSlash',
    tone: 'accent',
    title: 'Know what works offline',
    text: 'Airports and the map regions you download work in the air. Weather, TFRs and NOTAMs need the internet.',
  },
  { icon: 'shield', tone: 'caution', title: PRIMARY_NAVIGATION.title, text: ONBOARDING_SUMMARY },
];
