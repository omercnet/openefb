// The map screen's two layouts (efb-212/Views/Map/MapContainerView.swift). Swift switches on the horizontal size class;
// React Native has none, so the window width stands in for it (docs/research/rn-rewrite-plan.md, ticket U5).
import { useWindowDimensions } from 'react-native';

export type WidthClass = 'compact' | 'regular';

/**
 * Windows narrower than this (points) are compact. UIKit reports compact for every iPhone in portrait and for the
 * narrow iPad Split View panes (half of an 11" iPad in landscape is 590 pt), regular for half of a 13" iPad (678 pt).
 * The 400 pt strip also needs a usable chart beside it: at 600 pt the chart keeps 199 pt.
 */
export const COMPACT_BELOW = 600;

export function widthClass(width: number): WidthClass {
  return width < COMPACT_BELOW ? 'compact' : 'regular';
}

/**
 * The compact layout (header on top, NEXT rail beside the chart, NOW and the footer under it) on a compact window, and on
 * any window while the flight log is hidden: there it runs at full width without the rail, so the header, warnings and
 * footer stay (MapContainerView: `horizontalSizeClass == .compact || !showsFlightLog`).
 */
export function usesCompactLayout(windowClass: WidthClass, showsFlightLog: boolean): boolean {
  return windowClass === 'compact' || !showsFlightLog;
}

/** The current window's width class; re-renders on rotation, Split View and window resizes. */
export function useWidthClass(): { widthClass: WidthClass; width: number } {
  const { width } = useWindowDimensions();
  return { widthClass: widthClass(width), width };
}
