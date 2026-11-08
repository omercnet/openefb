import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { Platform, Settings } from 'react-native';
import { SelfTestScreen } from './src/native/SelfTestScreen';
import { SheetScreen } from './src/native/SheetScreen';
import { MapScreen } from './src/screens/MapScreen';

type Route = 'map' | 'airport' | 'night' | 'selftest' | 'sheet';
const ROUTES: Route[] = ['map', 'airport', 'night', 'selftest', 'sheet'];

// Screen is chosen so CI can drive it: kanaf-rn://airport (Android), ?screen=airport (web preview), and on iOS the
// launch argument `-KanafScreen airport` (NSUserDefaults), because `simctl openurl` with a custom scheme stops at a
// system "Open in ...?" confirmation that cannot be accepted headlessly.
function parse(url: string | null): Route {
  if (!url) return 'map';
  const m = /screen=([a-z]+)/.exec(url) ?? /^[a-z0-9-]+:\/\/\/?([a-z]+)/.exec(url);
  const r = m?.[1] as Route | undefined;
  return r && ROUTES.includes(r) ? r : 'map';
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => {
    if (Platform.OS === 'web') return parse(globalThis.location?.search ?? null);
    if (Platform.OS === 'ios') return parse(`screen=${String(Settings.get('KanafScreen') ?? '')}`);
    return 'map';
  });
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    Linking.getInitialURL().then((u) => setRoute(parse(u)));
    const sub = Linking.addEventListener('url', (e) => setRoute(parse(e.url)));
    return () => sub.remove();
  }, []);
  if (route === 'selftest') return <SelfTestScreen />;
  if (route === 'sheet') return <SheetScreen />;
  return <MapScreen screen={route} />;
}
