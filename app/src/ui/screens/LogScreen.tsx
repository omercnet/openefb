// The full-screen Log (efb-212/Views/Log/LogStackView.swift), on the Day palette unless told otherwise. The capture route renders it on its
// own, so it registers the bundled faces and provides the safe area itself.
import { useFonts } from 'expo-font';
import { View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogStack } from '../log/LogStack';
import { ThemeContext } from '../Primitives';
import { Day, FontFiles, type Theme } from '../tokens';

// Safe area of the iPad Pro 13-inch the reference was taken on (points), where the platform reports none (web), as in
// StripColumn.tsx: status bar 32, home indicator 20.
const FALLBACK_INSETS = { top: 32, bottom: 20 };

function LogContent({ theme }: { theme: Theme }) {
  const [fontsLoaded, fontError] = useFonts(FontFiles);
  const insets = useSafeAreaInsets();
  // Until the bundled faces are registered, show the bare paper: no text in a fallback face.
  const ready = fontsLoaded || fontError != null;
  return (
    <View style={{ flex: 1, backgroundColor: theme.paper, paddingTop: insets.top || FALLBACK_INSETS.top }}>
      {ready ? <LogStack bottomInset={insets.bottom || FALLBACK_INSETS.bottom} /> : null}
    </View>
  );
}

export function LogScreen({ theme = Day }: { theme?: Theme }) {
  return (
    <SafeAreaProvider>
      <ThemeContext.Provider value={theme}>
        <LogContent theme={theme} />
      </ThemeContext.Provider>
    </SafeAreaProvider>
  );
}
