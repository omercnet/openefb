import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../Primitives';
import { LogScreen } from '../screens/LogScreen';
import { LogbookEntryScreen } from '../screens/LogbookEntryScreen';
import { useAppStore, appStore } from '../state/appStore';
import { useLiveTheme } from '../state/night';
import type { LogbookEntryStore } from '../state/logbookEntryStore';

/** A screen over the map (the map stays mounted underneath, as ContentView's ZStack keeps MapContainerView alive). */
function Layer({ children, testID }: { children: ReactNode; testID: string }) {
  const theme = useLiveTheme();
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.paper }]} testID={testID}>
      <SafeAreaProvider>
        <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
      </SafeAreaProvider>
    </View>
  );
}

/**
 * ContentView's `selectedScreen == .log` layer and the screens pushed over the log stack. `renderPlanner` and the other
 * overlays arrive with their screens; an overlay with no renderer shows nothing.
 */
export function LiveScreens({
  logbookEntry,
  renderPlanner,
  renderFlight,
  onOverlayClosed,
}: {
  logbookEntry: LogbookEntryStore;
  renderPlanner?: (close: () => void) => ReactNode;
  /** A recorded flight and the screens pushed from it; absent while the recording database is not open. */
  renderFlight?: (flightId: string, close: () => void) => ReactNode;
  /** The pushed screen went away (Back, saved, signed): the log lists are read again. */
  onOverlayClosed?: () => void;
}) {
  const screen = useAppStore((s) => s.selectedScreen);
  const overlay = useAppStore((s) => s.overlay);
  const liveTheme = useLiveTheme();
  const close = () => {
    appStore.getState().openOverlay(null);
    onOverlayClosed?.();
  };
  return (
    <>
      {screen === 'log' ? (
        <Layer testID="live-log">
          <LogScreen theme={liveTheme} />
        </Layer>
      ) : null}
      {screen === 'log' && overlay?.kind === 'entry' ? (
        <Layer testID="live-entry">
          <LogbookEntryScreen key={overlay.id} store={logbookEntry} entryId={overlay.id} onClose={close} />
        </Layer>
      ) : null}
      {screen === 'log' && overlay?.kind === 'planner' && renderPlanner ? (
        <Layer testID="live-planner">{renderPlanner(close)}</Layer>
      ) : null}
      {screen === 'log' && overlay?.kind === 'flight' && renderFlight ? (
        <Layer testID="live-flight">{renderFlight(overlay.id, close)}</Layer>
      ) : null}
    </>
  );
}
