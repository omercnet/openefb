// Status bar content (clock, battery, signal) against the screen under it. SwiftUI's default status bar follows the
// colour scheme, and the palette follows the colour scheme there: dark content on the Day palette and the light screens,
// light content on the Night palette. Here the palette is chosen per screen, not by the system appearance (app.config's
// userInterfaceStyle 'automatic' would give a phone in dark mode white icons on the light screens), so the style is set
// explicitly. React Native's status bar sets the window's light-status-bar appearance on Android, which also holds
// edge-to-edge, where the bar has no background of its own.
import { StatusBar } from 'expo-status-bar';
import type { Theme } from './tokens';

/** Status bar content style: `dark` glyphs for light backgrounds, `light` glyphs for dark ones. */
export type StatusBarContent = 'dark' | 'light';

/** Screens without a palette of their own (forms, sheets, logbook, settings) are light. */
export const LIGHT_SCREEN_STATUS_BAR: StatusBarContent = 'dark';

/** Relative luminance (WCAG) of a `#RRGGBB` colour. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** The style for a palette, from the header band the status bar sits on: Day `dark`, Night `light`. */
export function statusBarStyleFor(theme: Theme): StatusBarContent {
  return luminance(theme.paperSecondary) < 0.18 ? 'light' : 'dark';
}

/**
 * The status bar for a screen in this palette. React Native keeps a stack of mounted status bars and the most recently
 * mounted one wins, so a screen's bar overrides the app-wide default the root layout mounts before the routes.
 */
export function ThemedStatusBar({ theme }: { theme: Theme }) {
  return <StatusBar style={statusBarStyleFor(theme)} />;
}

/** The app-wide default for light screens; the root layout mounts it before the routes so any screen's bar wins. */
export function DefaultStatusBar() {
  return <StatusBar style={LIGHT_SCREEN_STATUS_BAR} />;
}
