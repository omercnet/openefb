// The screens as the fidelity captures and the web preview mount them (routes kanaf-dev://settings, onboarding,
// disclaimers; iOS -KanafScreen). Fakes only, and no navigation: I1 mounts the real screens in the app shell.
import { useState, type ReactNode } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { FakePreferences } from '../../domain/ports/preferences';
import { ThemeContext } from '../Primitives';
import { Day } from '../tokens';
import { captureSettingsServices } from './captureFixtures';
import { DisclaimersScreen } from './DisclaimersScreen';
import { OnboardingScreen } from './OnboardingScreen';
import { SettingsScreen } from './SettingsScreen';

const STRIP_WIDTH = 400; // the SwiftUI strip (docs/DESIGN.md); the log stack's NavigationStack presents Settings inside it

/** Settings and its pages sit in the leading strip column beside the map on a wide screen, as on iPad. */
export function StripFrame({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  return (
    <SafeAreaProvider>
      <ThemeContext.Provider value={Day}>
        <View style={{ flex: 1, flexDirection: 'row', backgroundColor: Day.paper }}>
          <View style={{ width: width < 600 ? '100%' : STRIP_WIDTH }}>{children}</View>
        </View>
      </ThemeContext.Provider>
    </SafeAreaProvider>
  );
}

const noNavigation = {
  onOpenProfiles: () => undefined,
  onOpenOfflineMaps: () => undefined,
  onOpenDisclaimers: () => undefined,
  openURL: () => undefined,
};

export function SettingsCapture() {
  const [services] = useState(captureSettingsServices);
  return (
    <StripFrame>
      <SettingsScreen services={services} navigation={noNavigation} />
    </StripFrame>
  );
}

export function DisclaimersCapture() {
  return (
    <StripFrame>
      <DisclaimersScreen onBack={() => undefined} />
    </StripFrame>
  );
}

export function OnboardingCapture() {
  const [prefs] = useState(() => new FakePreferences());
  return (
    <SafeAreaProvider>
      <ThemeContext.Provider value={Day}>
        <OnboardingScreen prefs={prefs} onDone={() => undefined} />
      </ThemeContext.Provider>
    </SafeAreaProvider>
  );
}
