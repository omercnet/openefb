// The 400pt leading column of the iPad map screen (efb-212/Views/Map/MapContainerView.swift regularLayout):
// the flight log strip (FlightLogStrip.swift) or the airport column, over the footer, in the day or night palette.
import { useFonts } from 'expo-font';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AirportColumn, AirportHeader } from './AirportColumn';
import { FlightLogFooter } from './FlightLogFooter';
import { FlightLogHeader } from './FlightLogHeader';
import { FlightLogNext } from './FlightLogNext';
import { FlightLogNow } from './FlightLogNow';
import { ColumnRule, ThemeContext } from './Primitives';
import { Day, FontFiles, Night } from './tokens';

export type StripScreen = 'map' | 'airport' | 'night';

// Safe area of the iPad Pro 13-inch the references were taken on (points), used where the platform reports none
// (react-native-web): status bar 32, home indicator 20.
const FALLBACK_INSETS = { top: 32, bottom: 20 };

export function StripColumn({ screen, width }: { screen: StripScreen; width: number }) {
  const theme = screen === 'night' ? Night : Day;
  const [fontsLoaded, fontError] = useFonts(FontFiles);
  const insets = useSafeAreaInsets();
  const top = insets.top || FALLBACK_INSETS.top;
  const bottom = insets.bottom || FALLBACK_INSETS.bottom;
  // Until the bundled faces are registered, show the bare paper: no text in a fallback face.
  const ready = fontsLoaded || fontError != null;
  return (
    <ThemeContext.Provider value={theme}>
      <View accessibilityLabel={screen === 'airport' ? undefined : 'Flight log'} style={{ width, backgroundColor: theme.paper }}>
        {/* The header band runs up under the status bar. */}
        <View style={{ height: top, backgroundColor: theme.paperSecondary }} />
        {ready ? (
          <>
            {screen === 'airport' ? (
              <>
                <AirportHeader />
                <AirportColumn />
              </>
            ) : (
              <View style={{ flex: 1 }}>
                <FlightLogHeader />
                <ColumnRule />
                <FlightLogNext />
                <FlightLogNow />
              </View>
            )}
            <FlightLogFooter width={width} bottomInset={bottom} />
          </>
        ) : null}
      </View>
    </ThemeContext.Provider>
  );
}
