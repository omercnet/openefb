// The 400pt leading column of the iPad map screen (efb-212/Views/Map/MapContainerView.swift regularLayout): the strip
// column the pilot has open (flight log, airport, nearest, layers or search) over the footer, in the day or night palette.
// Like SwiftUI, the column shrinks above the software keyboard (Search types into it), so the footer stays visible and
// sits on the keyboard instead of under it, without the home-indicator padding the keyboard now covers. `padding` on both
// platforms: Expo apps are edge-to-edge on Android, where the window no longer resizes for the keyboard and a view
// without a behaviour stays under it.
import { useFonts } from 'expo-font';
import { KeyboardAvoidingView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { StripColumnKind } from '../domain/types';
import { AirportColumn } from './columns/AirportColumn';
import { LayersColumn } from './columns/LayersColumn';
import { NearestColumn } from './columns/NearestColumn';
import { SearchColumn } from './columns/SearchColumn';
import { FlightLogFooter } from './flightLog/FlightLogFooter';
import { FlightLogStrip } from './flightLog/FlightLogStrip';
import { ThemeContext } from './Primitives';
import { useAppStore } from './state/appStore';
import { Day, FontFiles, Night, type Theme } from './tokens';
import { useKeyboardVisible } from './useKeyboardVisible';

/** The kanaf-dev://<screen> routes the fidelity gate captures; `night` is the flight log in the night palette. */
export type StripScreen = 'map' | 'airport' | 'night' | 'layers' | 'nearest' | 'search';

/** What fills the strip column (and, in the compact layout, the area above the NOW cell) for each open column. */
export const STRIP_COLUMNS: Record<StripColumnKind, () => React.JSX.Element> = {
  log: FlightLogStrip,
  airport: AirportColumn,
  nearest: NearestColumn,
  layers: LayersColumn,
  search: SearchColumn,
};

// Safe area of the iPad Pro 13-inch the references were taken on (points), used where the platform reports none
// (react-native-web): status bar 32, home indicator 20.
const FALLBACK_INSETS = { top: 32, bottom: 20 };

/**
 * What both map layouts share: the palette for the screen, whether the bundled faces are registered (until then the
 * layouts show bare paper, no text in a fallback face) and the top and bottom safe-area insets (points).
 */
export function useStripChrome(screen?: StripScreen): { theme: Theme; ready: boolean; top: number; bottom: number } {
  const [fontsLoaded, fontError] = useFonts(FontFiles);
  const insets = useSafeAreaInsets();
  return {
    theme: screen === 'night' ? Night : Day,
    ready: fontsLoaded || fontError != null,
    top: insets.top || FALLBACK_INSETS.top,
    bottom: insets.bottom || FALLBACK_INSETS.bottom,
  };
}

export function StripColumn({ screen, width }: { screen?: StripScreen; width: number }) {
  const { theme, ready, top, bottom } = useStripChrome(screen);
  const column = useAppStore((s) => s.stripColumn);
  const keyboardVisible = useKeyboardVisible();
  const Column = STRIP_COLUMNS[column];
  return (
    <ThemeContext.Provider value={theme}>
      <KeyboardAvoidingView behavior="padding" style={{ width, backgroundColor: theme.paper }}>
        {/* The header band runs up under the status bar. */}
        <View style={{ height: top, backgroundColor: theme.paperSecondary }} />
        {ready ? (
          <>
            <View style={{ flex: 1 }}>
              <Column />
            </View>
            <FlightLogFooter width={width} bottomInset={keyboardVisible ? 0 : bottom} />
          </>
        ) : null}
      </KeyboardAvoidingView>
    </ThemeContext.Provider>
  );
}
