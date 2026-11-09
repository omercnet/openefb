import { Slot } from 'expo-router';

// One screen at a time, like the spike's route switch: Slot unmounts the previous route, so only one MapLibre view
// is ever alive. Add a nested <Stack> layout under a route group when a stack screen (logbook, settings) needs one.
export default function RootLayout() {
  return <Slot />;
}
