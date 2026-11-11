import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Settings } from 'react-native';
import { OTA_RELOAD_FILE, readResult } from '../adapters/resultFile';
import { MapScreen } from '../ui/screens/MapScreen';

// CI picks a screen without a deep link where it cannot: on iOS the launch argument `-KanafScreen airport`
// (NSUserDefaults), because `simctl openurl` with a custom scheme stops at a system confirmation that cannot be
// accepted headlessly; on web `?screen=airport`. Android uses the kanaf-dev://<screen> deep link, which the router
// resolves straight to its route, so this screen only sees launches without a URL.
const LAUNCH_SCREENS = [
  'airport',
  'night',
  'selftest',
  'sheet',
  'ota',
  'settings',
  'onboarding',
  'disclaimers',
  'aircraft',
  'aircraftedit',
  'pilot',
  'logbookentry',
  'logbooklocked',
  'recording',
  'recordingstopped',
  'recordingstop',
];

/** The screen requested at launch without a deep link (iOS launch argument, web query), if any. */
function launchScreen(): string | null {
  const raw =
    Platform.OS === 'web'
      ? new URLSearchParams(globalThis.location?.search ?? '').get('screen')
      : Platform.OS === 'ios'
        ? String(Settings.get('KanafScreen') ?? '')
        : '';
  return raw && LAUNCH_SCREENS.includes(raw) ? raw : null;
}

/** Root route: the map, or the screen requested at launch (also after an Android OTA reload). */
export default function Index() {
  const router = useRouter();
  const [screen] = useState(launchScreen);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    // After Updates.reloadAsync the intent URL is gone; OtaScreen leaves a marker so the ota route survives.
    readResult(OTA_RELOAD_FILE)
      .then((marker) => marker && router.replace('/ota'))
      .catch(() => null);
  }, [router]);
  if (screen) return <Redirect href={`/${screen}`} />;
  return <MapScreen screen="map" />;
}
