// A1: location entries in app.config.ts match the SwiftUI target (efb-212.xcodeproj, Info.plist).
import type { ExpoConfig } from 'expo/config';

import appConfig from '../../app.config';

const config: ExpoConfig = appConfig({ config: {} } as Parameters<typeof appConfig>[0]);

function locationPluginOptions(): Record<string, unknown> {
  const entry = config.plugins?.find((p) => Array.isArray(p) && p[0] === 'expo-location');
  if (!Array.isArray(entry)) throw new Error('expo-location plugin missing');
  return entry[1] as Record<string, unknown>;
}

describe('app.config location entries', () => {
  it('uses the Swift usage strings and no NSLocationAlwaysUsageDescription', () => {
    expect(locationPluginOptions()).toMatchObject({
      locationWhenInUsePermission:
        'Kanaf uses your location to show your position on the aviation map and provide navigation guidance.',
      locationAlwaysAndWhenInUsePermission:
        'Kanaf uses your location in the background to continue tracking your flight when the screen is off.',
      locationAlwaysPermission: false,
    });
  });

  it('enables iOS background location and the Android background location foreground service', () => {
    expect(locationPluginOptions()).toMatchObject({
      isIosBackgroundLocationEnabled: true,
      isAndroidBackgroundLocationEnabled: true,
      isAndroidForegroundServiceEnabled: true,
    });
  });

  it('declares the Android location permissions', () => {
    expect(config.android?.permissions).toEqual(
      expect.arrayContaining([
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.ACCESS_BACKGROUND_LOCATION',
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_LOCATION',
      ]),
    );
  });
});
