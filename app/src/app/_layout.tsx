import { Slot } from 'expo-router';
import { DefaultStatusBar } from '../ui/SystemBars';

// One screen at a time, like the spike's route switch: Slot unmounts the previous route, so only one MapLibre view
// is ever alive. Add a nested <Stack> layout under a route group when a stack screen (logbook, settings) needs one.
// The default status bar comes first: siblings mount in order, so a route's own bar (the strip's palette) mounts after it
// and wins, and leaving that route falls back to the default.
export default function RootLayout() {
  return (
    <>
      <DefaultStatusBar />
      <Slot />
    </>
  );
}
