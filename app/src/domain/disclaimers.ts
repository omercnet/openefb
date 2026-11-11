// Port of efb-212/Core/Disclaimers.swift: the five disclaimers required by PRD.md section 12, verbatim.
// Shown in Settings > Legal > Disclaimers; the primary-navigation item is also on the onboarding screen, with the short
// form in ONBOARDING_SUMMARY. disclaimers.test.ts reads the Swift file in place and asserts the text is identical.

export interface Disclaimer {
  readonly id: string;
  readonly title: string;
  readonly text: string;
}

/** Short form for the onboarding screen. The full text is PRIMARY_NAVIGATION. */
export const ONBOARDING_SUMMARY =
  'Kanaf is a supplemental reference. Fly with current charts, ATC and what you see outside. iPad GPS is not certified, and this app is not FAA-approved.';

/** Disclaimers.primaryNavigation */
export const PRIMARY_NAVIGATION: Disclaimer = {
  id: 'Not for primary navigation',
  title: 'Not for primary navigation',
  text: 'Kanaf is provided as a supplemental reference tool. It is NOT intended to be used as a primary means of navigation. Pilots are responsible for maintaining situational awareness through all available means including current paper charts, ATC communication, and visual references.',
};

/** Disclaimers.dataCurrency */
export const DATA_CURRENCY: Disclaimer = {
  id: 'Data currency',
  title: 'Data currency',
  text: 'Aviation data (charts, airports, frequencies, airspace) is sourced from the FAA and is subject to change. Always verify information against official FAA publications. Expired data is clearly marked but should not be relied upon for navigation.',
};

/** Disclaimers.weather */
export const WEATHER: Disclaimer = {
  id: 'Weather',
  title: 'Weather',
  text: 'Weather information is provided for planning purposes only and may not reflect current conditions. Always obtain an official weather briefing from 1800wxbrief.com or FSS before flight.',
};

/** Disclaimers.gps */
export const GPS: Disclaimer = {
  id: 'GPS',
  title: 'GPS',
  text: 'iPad GPS accuracy varies by model and conditions. WiFi-only iPads do not have GPS hardware. Cellular iPad GPS is not TSO-certified. Do not rely on iPad GPS as a sole means of position awareness.',
};

/** Disclaimers.notFAAApproved */
export const NOT_FAA_APPROVED: Disclaimer = {
  id: 'Not FAA-approved',
  title: 'Not FAA-approved',
  text: 'Kanaf has not been tested, approved, or certified by the FAA or any other aviation authority. Use at your own risk.',
};

export const DISCLAIMERS: readonly Disclaimer[] = [PRIMARY_NAVIGATION, DATA_CURRENCY, WEATHER, GPS, NOT_FAA_APPROVED];
