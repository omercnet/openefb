// The 400pt leading column of the iPad map screen (efb-212/Views/Map/MapContainerView.swift regularLayout): the strip
// column the pilot has open (flight log, airport, nearest, layers or search) over the footer, in the day or night palette.
// Like SwiftUI, the column shrinks above the software keyboard (Search types into it), so the footer stays visible and
// sits on the keyboard instead of under it, without the home-indicator padding the keyboard now covers.
import { useFonts } from 'expo-font';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
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
import { Day, FontFiles, Night } from './tokens';
import { useKeyboardVisible } from './useKeyboardVisible';

/** The kanaf-dev://<screen> routes the fidelity gate captures; `night` is the flight log in the night palette. */
export type StripScreen = 'map' | 'airport' | 'night' | 'layers' | 'nearest' | 'search';

const COLUMNS: Record<StripColumnKind, () => React.JSX.Element> = {
  log: FlightLogStrip,
  airport: AirportColumn,
  nearest: NearestColumn,
  layers: LayersColumn,
  search: SearchColumn,
};

// Safe area of the iPad Pro 13-inch the references were taken on (points), used where the platform reports none
// (react-native-web): status bar 32, home indicator 20.
const FALLBACK_INSETS = { top: 32, bottom: 20 };

export function StripColumn({ screen, width }: { screen?: StripScreen; width: number }) {
  const theme = screen === 'night' ? Night : Day;
  const [fontsLoaded, fontError] = useFonts(FontFiles);
  const insets = useSafeAreaInsets();
  const column = useAppStore((s) => s.stripColumn);
  const keyboardVisible = useKeyboardVisible();
  const top = insets.top || FALLBACK_INSETS.top;
  const bottom = insets.bottom || FALLBACK_INSETS.bottom;
  // Until the bundled faces are registered, show the bare paper: no text in a fallback face.
  const ready = fontsLoaded || fontError != null;
  const Column = COLUMNS[column];
  return (
    <ThemeContext.Provider value={theme}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width, backgroundColor: theme.paper }}>
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
