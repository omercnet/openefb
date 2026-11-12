// The map screen's two layouts (efb-212/Views/Map/MapContainerView.swift). Swift switches on the horizontal size class;
// React Native has none, so the device class stands in for it (docs/research/rn-rewrite-plan.md, ticket U5).
import { Dimensions, Platform, useWindowDimensions } from 'react-native';

export type WidthClass = 'compact' | 'regular';

/** Windows narrower than this (points) are compact on a tablet: half of an 11" iPad in landscape is 590 pt, half of a 13" 678 pt. */
export const COMPACT_BELOW = 600;
/**
 * iPhone Plus and Max models (portrait width 414, 428, 430, 440 pt) report a REGULAR horizontal size class in landscape;
 * every other iPhone (375 to 402 pt wide) stays compact. UIKit decides it by the device, so the shorter side is the key.
 */
export const IPHONE_REGULAR_LANDSCAPE_FROM = 414;

export interface DeviceInfo {
  os: string;
  /** iOS only: Platform.isPad. */
  isPad: boolean;
  window: { width: number; height: number };
  screen: { width: number; height: number };
}

/**
 * The horizontal size class MapContainerView switches on, from the device class and not the current window width:
 * - iPhone: compact in portrait; in landscape compact except on the Plus and Max models (regular, as UIKit reports).
 * - Android phone (smallest screen width under 600 dp, which rotation does not change): always compact.
 * - Tablets and the web preview: by window width (`COMPACT_BELOW`), so a Split View pane can be compact.
 */
export function sizeClass({ os, isPad, window, screen }: DeviceInfo): WidthClass {
  if (os === 'ios' && !isPad) {
    const landscape = window.width > window.height;
    return landscape && Math.min(window.width, window.height) >= IPHONE_REGULAR_LANDSCAPE_FROM ? 'regular' : 'compact';
  }
  if (os === 'android' && Math.min(screen.width, screen.height) < COMPACT_BELOW) return 'compact';
  return window.width < COMPACT_BELOW ? 'compact' : 'regular';
}

/**
 * The compact layout (header on top, NEXT rail beside the chart, NOW and the footer under it) on a compact window, and on
 * any window while the flight log is hidden: there it runs at full width without the rail, so the header, warnings and
 * footer stay (MapContainerView: `horizontalSizeClass == .compact || !showsFlightLog`).
 */
export function usesCompactLayout(windowClass: WidthClass, showsFlightLog: boolean): boolean {
  return windowClass === 'compact' || !showsFlightLog;
}

/** The current device's size class and window width; re-renders on rotation, Split View and window resizes. */
export function useWidthClass(): { widthClass: WidthClass; width: number } {
  const window = useWindowDimensions();
  const screen = Dimensions.get('screen');
  const isPad = Platform.OS === 'ios' && Platform.isPad === true;
  return { widthClass: sizeClass({ os: Platform.OS, isPad, window, screen }), width: window.width };
}
