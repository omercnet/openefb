// Native capability self test (kanaf-rn://selftest). Runs each check in turn, shows PASS/FAIL, writes one JSON blob
// to <documents>/spike-result.json and logs it as "SPIKE_RESULT {...}" plus numbered "SPIKE_RESULT_PART <i> <chunk>" lines
// and "SPIKE_RESULT_END <n>" (Android logcat truncates a line near 4 KB; android-capture.sh reassembles the parts).
// One failing or hanging check never stops the others: each is caught and bounded by a timeout.
import Constants from 'expo-constants';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, type AudioRecorder } from 'expo-audio';
import { File } from 'expo-file-system';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import * as TaskManager from 'expo-task-manager';
import { useEffect, useRef, useState } from 'react';
import { Dimensions, PixelRatio, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import Pdf from 'react-native-pdf';
import { openAviationDb } from '../map/aviationDb';
import { ANIMATION_FILE, SELFTEST_FILE, readResult, writeResult } from './resultFile';

const LOCATION_TASK = 'kanaf-spike-location';
let taskFixes = 0;
// Task executors must be defined at module scope so they exist when the OS wakes the app.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (!error && data) taskFixes += data.locations.length;
});

type Details = { ok: boolean } & Record<string, unknown>;
type CheckResult = { name: string; ok: boolean; ms: number; details?: Record<string, unknown>; error?: string };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const elapsed = (t0: number) => Math.round((performance.now() - t0) * 10) / 10;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms))]);
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = performance.now();
  const value = await fn();
  return [value, elapsed(t0)];
}

/** Smallest valid one-page PDF ("KSQL" on a 200 x 100 pt page) with a byte-exact xref table, as a data URI. */
export function minimalPdfDataUri(): string {
  const stream = 'BT /F1 24 Tf 20 40 Td (KSQL) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return 'data:application/pdf;base64,' + btoa(pdf);
}

// (a) aviation.sqlite: build flags, R-tree bbox, FTS5 search and a runway join (queries from AviationDatabase.swift).
async function checkSqlite(): Promise<Details> {
  const [db, openMs] = await timed(openAviationDb);
  const version = (await db.getFirstAsync<{ v: string }>('SELECT sqlite_version() AS v'))?.v;
  const options = (await db.getAllAsync<{ compile_options: string }>('PRAGMA compile_options')).map((r) => r.compile_options);
  const rtree = options.includes('ENABLE_RTREE');
  const fts5 = options.includes('ENABLE_FTS5');
  const errors: string[] = [];
  let bayCount = -1;
  let bayMs = -1;
  try {
    // San Francisco Bay box: 37.2-38.0 N, 122.6-121.8 W (31 airports in the 2026-10-29 NASR cycle)
    const [row, ms] = await timed(() => db.getFirstAsync<{ n: number }>(
      `SELECT count(*) AS n FROM airports a INNER JOIN airports_rtree r ON a.rowid = r.rowid
       WHERE r.min_lat <= ? AND r.max_lat >= ? AND r.min_lon <= ? AND r.max_lon >= ?`, [38.0, 37.2, -121.8, -122.6]));
    [bayCount, bayMs] = [row?.n ?? -1, ms];
  } catch (e) {
    errors.push(`rtree: ${String(e)}`);
  }
  let ftsFirst: string | null = null;
  let ftsMs = -1;
  try {
    // AviationDatabase.ftsMatchExpression("san carlos") == "\"san\"* \"carlos\"*"
    const [rows, ms] = await timed(() => db.getAllAsync<{ icao: string }>(
      `SELECT a.icao FROM airports a INNER JOIN airports_fts fts ON a.rowid = fts.rowid
       WHERE airports_fts MATCH ? ORDER BY rank LIMIT 20`, ['"san"* "carlos"*']));
    [ftsFirst, ftsMs] = [rows[0]?.icao ?? null, ms];
  } catch (e) {
    errors.push(`fts5: ${String(e)}`);
  }
  // Runway length and width in feet
  const runways = await db.getAllAsync<{ id: string; length: number; width: number; surface: string }>(
    'SELECT r.id, r.length, r.width, r.surface FROM airports a JOIN runways r ON r.airport_icao = a.icao WHERE a.icao = ?', ['KSQL']);
  return {
    ok: rtree && fts5 && bayCount > 0 && ftsFirst === 'KSQL' && runways.some((r) => r.id === '12/30'),
    version, rtree, fts5, openMs, bayCount, bayMs, ftsFirst, ftsMs, runways, errors,
  };
}

// (b) location: foreground permission, 5 s of watchPositionAsync, then background updates through a TaskManager task.
async function checkLocation(): Promise<Details> {
  const fg = await Location.requestForegroundPermissionsAsync();
  // Which path answers: device settings, provider availability (Android: gps / network / passive), the cached fix,
  // a one-shot fix and the 5 s watch. `mocked` is true on Android for test-provider fixes, false for emulator `geo fix`.
  const servicesEnabled = await Location.hasServicesEnabledAsync().catch((e) => String(e));
  const providers = await Location.getProviderStatusAsync().catch((e) => String(e));
  const lastKnown = await Location.getLastKnownPositionAsync().then((l) => (l ? { mocked: l.mocked ?? null, ageMs: Date.now() - l.timestamp } : null), (e) => String(e));
  let updates = 0;
  let last: Location.LocationObjectCoords | null = null;
  let watchMocked: boolean | null = null;
  let current: unknown = null;
  if (fg.granted) {
    const sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 }, (loc) => {
      updates += 1;
      last = loc.coords;
      watchMocked = loc.mocked ?? null;
    });
    await sleep(5000);
    sub.remove();
    current = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 10_000, 'getCurrentPositionAsync')
      .then((l) => ({ lat: l.coords.latitude, lon: l.coords.longitude, mocked: l.mocked ?? null }), (e) => String(e));
  }
  const bg = await withTimeout(Location.requestBackgroundPermissionsAsync(), 15_000, 'background permission').catch((e) => ({ granted: false, status: String(e) }));
  let started = false;
  let startError: string | null = null;
  try {
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: 1000,
      distanceInterval: 0,
      showsBackgroundLocationIndicator: true,
      foregroundService: { notificationTitle: 'Kanaf spike', notificationBody: 'Recording the flight track', killServiceOnDestroy: true },
    });
    started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    await sleep(3000);
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  } catch (e) {
    startError = String(e);
  }
  return {
    ok: fg.granted && updates > 0 && started,
    foreground: fg.status, background: bg.status, servicesEnabled, providers, lastKnown,
    updates, last, watchMocked, current, started, taskFixes, startError,
  };
}

// (c) audio: microphone permission and a 2 s recording with expo-audio.
async function checkAudio(recorder: AudioRecorder): Promise<Details> {
  const perm = await requestRecordingPermissionsAsync();
  if (!perm.granted) return { ok: false, permission: perm.status };
  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
  await recorder.prepareToRecordAsync();
  recorder.record();
  await sleep(2000);
  await recorder.stop();
  const bytes = recorder.uri ? new File(recorder.uri).size : 0;
  return { ok: bytes > 0, permission: perm.status, uri: recorder.uri, bytes };
}

// (d) Keychain / Keystore round trip.
async function checkSecureStore(): Promise<Details> {
  const value = `spike-${Date.now()}`;
  await SecureStore.setItemAsync('kanaf-spike', value);
  const back = await SecureStore.getItemAsync('kanaf-spike');
  await SecureStore.deleteItemAsync('kanaf-spike');
  return { ok: back === value, roundTrip: back === value };
}

// (f) speech recognition availability and on-device support (no permission prompt).
async function checkSpeech(): Promise<Details> {
  const m = ExpoSpeechRecognitionModule;
  const available = m.isRecognitionAvailable();
  const locales = await withTimeout(m.getSupportedLocales({}), 10_000, 'getSupportedLocales').catch((e) => String(e));
  return {
    ok: typeof available === 'boolean',
    available,
    onDevice: m.supportsOnDeviceRecognition(),
    supportsRecording: m.supportsRecording(),
    permission: (await m.getPermissionsAsync()).status,
    locales: typeof locales === 'string' ? locales : { count: locales.locales.length, installed: locales.installedLocales.length, enUS: locales.locales.includes('en-US') },
    services: Platform.OS === 'android' ? m.getSpeechRecognitionServices() : undefined,
    defaultService: Platform.OS === 'android' ? m.getDefaultRecognitionService().packageName : undefined,
  };
}

/** Model, OS and screen (points and density) without expo-device: Platform.constants, Dimensions, PixelRatio. */
function deviceInfo() {
  const c = Platform.constants as unknown as Record<string, unknown>;
  const screen = Dimensions.get('screen');
  return {
    // Android: Build.MANUFACTURER / MODEL; iOS: the simulator or device name and idiom (pad / phone)
    model: Platform.OS === 'android' ? `${c.Manufacturer} ${c.Model}` : `${Constants.deviceName ?? 'unknown'} (${c.interfaceIdiom})`,
    os: `${Platform.OS} ${Platform.OS === 'android' ? `${c.Release} (API ${Platform.Version})` : Platform.Version}`,
    screenPt: { width: screen.width, height: screen.height },
    scale: PixelRatio.get(),
    fontScale: PixelRatio.getFontScale(),
  };
}

export function SelfTestScreen() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [results, setResults] = useState<CheckResult[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [pdfMounted, setPdfMounted] = useState(false);
  const pdfDone = useRef<((pages: number | Error) => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    const checkPdf = async (): Promise<Details> => {
      const pages = await withTimeout(new Promise<number | Error>((resolve) => {
        pdfDone.current = resolve;
        setPdfMounted(true);
      }), 20_000, 'react-native-pdf onLoadComplete');
      if (pages instanceof Error) throw pages;
      return { ok: pages === 1, onLoadComplete: true, pages };
    };
    const checks: [string, () => Promise<Details>][] = [
      ['sqlite', checkSqlite],
      ['location', checkLocation],
      ['audio', () => checkAudio(recorder)],
      ['secureStore', checkSecureStore],
      ['pdf', checkPdf],
      ['speech', checkSpeech],
    ];
    (async () => {
      const t0 = performance.now();
      const done: CheckResult[] = [];
      for (const [name, fn] of checks) {
        if (cancelled) return;
        setRunning(name);
        const c0 = performance.now();
        try {
          const { ok, ...details } = await withTimeout(fn(), 45_000, name);
          done.push({ name, ok, ms: elapsed(c0), details });
        } catch (e) {
          done.push({ name, ok: false, ms: elapsed(c0), error: e instanceof Error ? e.message : String(e) });
        }
        setResults([...done]);
      }
      setRunning(null);
      const result = {
        app: 'kanaf-rn-spike',
        platform: Platform.OS,
        osVersion: Platform.Version,
        deviceInfo: deviceInfo(),
        rnVersion: `${Platform.constants.reactNativeVersion.major}.${Platform.constants.reactNativeVersion.minor}.${Platform.constants.reactNativeVersion.patch}`,
        expoSdk: Constants.expoConfig?.sdkVersion ?? null,
        hermes: 'HermesInternal' in globalThis,
        // Fabric installs nativeFabricUIManager; bridgeless TurboModules install __turboModuleProxy (absent in some modes).
        newArch: { fabric: 'nativeFabricUIManager' in globalThis, turboModuleProxy: '__turboModuleProxy' in globalThis },
        finishedAt: new Date().toISOString(),
        durationMs: elapsed(t0),
        allPassed: done.every((c) => c.ok),
        checks: done,
        // Written by kanaf-rn://map?animate=1 (MapSurface) when CI ran it before the self test.
        animation: await readResult(ANIMATION_FILE).catch((e) => ({ error: String(e) })),
      };
      const json = JSON.stringify(result);
      console.log('SPIKE_RESULT ' + json);
      const parts = Math.ceil(json.length / 3000);
      for (let i = 0; i < parts; i++) console.log(`SPIKE_RESULT_PART ${i} ${json.slice(i * 3000, (i + 1) * 3000)}`);
      console.log(`SPIKE_RESULT_END ${parts}`);
      const path = await writeResult(SELFTEST_FILE, result).catch((e) => `write failed: ${String(e)}`);
      setSummary(`${result.allPassed ? 'ALL PASS' : 'FAILURES'}  -  ${path}`);
    })();
    return () => {
      cancelled = true;
    };
  }, [recorder]);

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Kanaf RN self test ({Platform.OS})</Text>
      <ScrollView>
        {results.map((r) => (
          <View key={r.name} style={styles.row}>
            <Text style={[styles.status, { color: r.ok ? '#1B7F3B' : '#C62828' }]}>{r.ok ? 'PASS' : 'FAIL'}</Text>
            <View style={styles.body}>
              <Text style={styles.name}>{r.name}  <Text style={styles.ms}>{r.ms} ms</Text></Text>
              <Text style={styles.detail} numberOfLines={4}>{r.error ?? JSON.stringify(r.details)}</Text>
            </View>
          </View>
        ))}
        {running && <Text style={styles.running}>running {running}...</Text>}
        {summary && <Text style={styles.summary}>{summary}</Text>}
      </ScrollView>
      {pdfMounted && (
        <Pdf
          source={{ uri: minimalPdfDataUri() }}
          style={styles.pdf}
          onLoadComplete={(pages) => pdfDone.current?.(pages)}
          onError={(e) => pdfDone.current?.(e instanceof Error ? e : new Error(String(e)))}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 32, paddingTop: 64, backgroundColor: '#FFFFFF' },
  title: { fontSize: 34, fontWeight: '700', marginBottom: 24, color: '#14191F' },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#C8C8C8' },
  status: { fontSize: 32, fontWeight: '800', width: 110 },
  body: { flex: 1 },
  name: { fontSize: 28, fontWeight: '600', color: '#14191F' },
  ms: { fontSize: 18, fontWeight: '400', color: '#6B6B6B' },
  detail: { fontSize: 14, color: '#3A3A3A', fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  running: { fontSize: 24, marginTop: 16, color: '#6B6B6B' },
  summary: { fontSize: 24, fontWeight: '700', marginTop: 16, color: '#14191F' },
  pdf: { width: 200, height: 100, alignSelf: 'flex-end' },
});
