import { useFonts } from 'expo-font';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { describeError } from '../../domain/describeError';
import { hasSeenOnboarding } from '../../domain/onboarding';
import { ThemeContext } from '../Primitives';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { Day, FontFiles } from '../tokens';
import { resetLiveSlices } from './resetSlices';
import { LiveApp } from './LiveApp';
import { getRuntime, startRecordingServices, type AppRuntime } from './runtime';

/**
 * The launch sequence in front of the first screen: the user database and its migrations, the saved region, the aviation
 * databases and the saved remote config (startup.ts), then the live app. Paper until then, like the Swift launch screen.
 */
export function LiveAppGate() {
  const [state, setState] = useState<{ runtime: AppRuntime; onboarded: boolean } | { error: string } | null>(null);
  const [fontsLoaded, fontError] = useFonts(FontFiles);
  useEffect(() => {
    let cancelled = false;
    getRuntime().then(
      async (runtime) => {
        // Swift: the onboarding shows until hasSeenOnboarding; an unreadable flag shows it again (the safe side).
        const onboarded = await hasSeenOnboarding(runtime.preferences);
        if (cancelled) return;
        resetLiveSlices(runtime.started.region, runtime.layerSettings);
        setState({ runtime, onboarded });
      },
      (error) => !cancelled && setState({ error: describeError(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, []);
  if (state && 'runtime' in state) {
    if (!state.onboarded) {
      // Until the bundled faces are registered show the bare paper: no text in a fallback face.
      if (!(fontsLoaded || fontError != null)) return <View style={styles.paper} testID="launchScreen" />;
      return (
        <ThemeContext.Provider value={Day}>
          <OnboardingScreen
            prefs={state.runtime.preferences}
            onDone={(result) => {
              if (!result.saved) console.warn(`The onboarding flag was not saved, it will show again: ${result.error}`);
              setState({ runtime: state.runtime, onboarded: true });
            }}
          />
        </ThemeContext.Provider>
      );
    }
    return <LiveApp runtime={state.runtime} startRecording={startRecordingServices} />;
  }
  return (
    <View style={styles.paper} testID="launchScreen">
      {state ? <Text style={styles.error}>{`Kanaf could not start: ${state.error}`}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  paper: { flex: 1, backgroundColor: Day.paper, justifyContent: 'center', padding: 24 },
  error: { color: Day.ink, fontSize: 16 },
});
