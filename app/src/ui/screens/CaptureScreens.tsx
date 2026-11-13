// The screens as the fidelity captures and the web preview mount them (routes kanaf-dev://settings, onboarding,
// disclaimers; iOS -KanafScreen). Fakes only, and no navigation: I1 mounts the real screens in the app shell.
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { FakePreferences } from '../../domain/ports/preferences';
import { ThemeContext } from '../Primitives';
import { Day } from '../tokens';
import { captureSettingsServices } from './captureFixtures';
import { DisclaimersScreen } from './DisclaimersScreen';
import { OnboardingScreen } from './OnboardingScreen';
import { SettingsScreen } from './SettingsScreen';

/**
 * Full screen, like the capture host's NavigationStack (CaptureRouteHost.swift): these screens fill the window on iPad and on
 * a tablet, not the 400 pt strip column. (In the shell, Settings opens from the Log's NavigationStack in the strip and the
 * rest push from it; I1 decides there. Swift's own capture shows them full width, which is what the gate compares.)
 */
export function ScreenFrame({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider>
      <ThemeContext.Provider value={Day}>
        <View style={{ flex: 1, backgroundColor: Day.paper }}>{children}</View>
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
    <ScreenFrame>
      <SettingsScreen services={services} navigation={noNavigation} />
    </ScreenFrame>
  );
}

export function DisclaimersCapture() {
  return (
    <ScreenFrame>
      <DisclaimersScreen onBack={() => undefined} />
    </ScreenFrame>
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
