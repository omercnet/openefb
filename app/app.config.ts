// Expo app config for Kanaf EFB (replaces app.json so options can carry comments).
// Mirrors the SwiftUI app's Info.plist at the repo root: UIBackgroundModes location + audio, the same usage
// strings, and the bundled fonts. No secrets here.
import { withInfoPlist, type ConfigPlugin } from 'expo/config-plugins';
import type { ConfigContext, ExpoConfig } from 'expo/config';

const FONTS = [
  'Archivo-Regular', 'Archivo-Medium', 'Archivo-SemiBold', 'Archivo-Condensed-SemiBold',
  'Archivo-ExtraCondensed-SemiBold', 'Archivo-ExtraCondensed-Bold',
  'IBMPlexMono-Regular', 'IBMPlexMono-Medium', 'IBMPlexMono-SemiBold',
  'IBMPlexSansHebrew-Regular', 'IBMPlexSansHebrew-Medium', 'IBMPlexSansHebrew-SemiBold',
].map((f) => `./assets/fonts/${f}.ttf`);

const MIC = 'Kanaf records cockpit audio during flights for transcription and debrief.';
const SPEECH = 'Kanaf transcribes cockpit audio in real-time to create flight transcripts.';
// Location usage strings verbatim from the SwiftUI target (efb-212.xcodeproj INFOPLIST_KEY_NSLocation*UsageDescription).
// The Swift app declares no NSLocationAlwaysUsageDescription (iOS 11+ reads AlwaysAndWhenInUse), so neither does this.
const LOCATION_WHEN_IN_USE =
  'Kanaf uses your location to show your position on the aviation map and provide navigation guidance.';
const LOCATION_ALWAYS_AND_WHEN_IN_USE =
  'Kanaf uses your location in the background to continue tracking your flight when the screen is off.';

// expo-task-manager adds UIBackgroundModes "fetch"; the SwiftUI app declares only location and audio.
const withOnlyLocationAudioBackground: ConfigPlugin = (c) =>
  withInfoPlist(c, (mod) => {
    mod.modResults.UIBackgroundModes = ['location', 'audio'];
    return mod;
  });

// Build variant. Production is the store identity io.omer.efb (same bundle id as the SwiftUI app, so iOS upgrades in
// place). KANAF_VARIANT=dev builds io.omer.efb.dev with its own scheme and name, installable next to production; CI
// smoke and OTA smoke builds use it.
const VARIANT = process.env.KANAF_VARIANT ?? 'production';
if (VARIANT !== 'production' && VARIANT !== 'dev') throw new Error(`KANAF_VARIANT must be dev or production, got ${VARIANT}`);
const DEV = VARIANT === 'dev';
const BUNDLE_ID = DEV ? 'io.omer.efb.dev' : 'io.omer.efb';

// OTA updates (web/ota) are built in only when KANAF_OTA_URL is set; otherwise the app has no update config.
//   KANAF_OTA_URL     manifest endpoint, e.g. https://ota.example.com/manifest
//   KANAF_OTA_CERT    code-signing certificate path (required with the URL: an unsigned-updates build is never made)
//   KANAF_OTA_CHANNEL channel header, default production
//   KANAF_OTA_SMOKE   1 = allow cleartext HTTP (the CI smoke test talks to wrangler dev on localhost)
const OTA_URL = process.env.KANAF_OTA_URL;
const OTA_CERT = process.env.KANAF_OTA_CERT;
if (OTA_URL && !OTA_CERT) throw new Error('KANAF_OTA_URL is set without KANAF_OTA_CERT: refusing to build unsigned updates');
const OTA_SMOKE = process.env.KANAF_OTA_SMOKE === '1';

export default ({ config }: ConfigContext): ExpoConfig => withOnlyLocationAudioBackground({
  ...config,
  name: DEV ? 'Kanaf EFB Dev' : 'Kanaf EFB',
  slug: 'kanaf',
  scheme: DEV ? 'kanaf-dev' : 'kanaf',
  version: '1.0.0',
  orientation: 'default',
  userInterfaceStyle: 'automatic',
  icon: './assets/splash-icon.png',
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: true,
    // MapLibre Native needs iOS 15.5+; Expo SDK 58 modules (expo-sqlite podspec) already require 16.4.
    deploymentTarget: '16.4',
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // Location (src/adapters/location.ts): fine/coarse for fixes, background for the flight track, and the
    // location foreground service that keeps updates alive with the screen off. expo-location adds these too;
    // listing them pins the manifest. POST_NOTIFICATIONS comes from expo-audio; the microphone foreground-service
    // type (API 34+) for background cockpit recording is added here.
    permissions: [
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
      'android.permission.FOREGROUND_SERVICE_MICROPHONE',
    ],
  },
  // A binary only receives updates built from the same native code (web/ota README: what needs a store release).
  runtimeVersion: { policy: 'fingerprint' },
  updates: OTA_URL ? {
    url: OTA_URL,
    enabled: true,
    checkAutomatically: 'NEVER', // the ota screen drives the check, so the smoke scenario is deterministic
    requestHeaders: { 'expo-channel-name': process.env.KANAF_OTA_CHANNEL ?? 'production' },
    codeSigningCertificate: OTA_CERT,
    codeSigningMetadata: { keyid: 'main', alg: 'rsa-v1_5-sha256' },
  } : { enabled: false },
  web: { favicon: './assets/favicon.png' },
  plugins: [
    'expo-router',
    '@maplibre/maplibre-react-native',
    // Stock expo-sqlite compiles FTS5 but not R-tree; aviation.sqlite has R-tree virtual tables
    // (airports_rtree, navaids_rtree, airspaces_rtree). Setting any flag also makes Android build
    // SQLite from source instead of the prebuilt AAR (android/shouldUsePublication.groovy).
    ['expo-sqlite', { customBuildFlags: '-DSQLITE_ENABLE_RTREE=1' }],
    ['expo-location', {
      locationWhenInUsePermission: LOCATION_WHEN_IN_USE,
      locationAlwaysAndWhenInUsePermission: LOCATION_ALWAYS_AND_WHEN_IN_USE,
      locationAlwaysPermission: false,
      isIosBackgroundLocationEnabled: true,
      isAndroidBackgroundLocationEnabled: true,
      // Android foreground service for background updates; its notification text is set per start in
      // src/adapters/location.ts (FOREGROUND_SERVICE_NOTIFICATION). No custom icon: the app icon is used.
      isAndroidForegroundServiceEnabled: true,
      motionUsagePermission: false, // no CoreMotion, as in the SwiftUI app
      locationFullAccuracyPermission: false,
    }],
    ['expo-audio', { microphonePermission: MIC, recordAudioAndroid: true, enableBackgroundRecording: true, enableBackgroundPlayback: false }],
    ['expo-secure-store', { faceIDPermission: false }],
    ['expo-speech-recognition', { microphonePermission: MIC, speechRecognitionPermission: SPEECH }],
    'expo-asset',
    ['expo-font', { fonts: FONTS }],
    ['expo-build-properties', {
      // compileSdk stays at the RN 0.88 default (37, react-native/gradle/libs.versions.toml); targetSdk pinned.
      android: { targetSdkVersion: 36, ...(OTA_SMOKE ? { usesCleartextTraffic: true } : {}) },
    }],
    'expo-updates',
    'react-native-blob-util',
  ],
});
