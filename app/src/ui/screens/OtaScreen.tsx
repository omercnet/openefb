// OTA smoke screen (kanaf-dev://ota, -KanafScreen ota). On each launch: record what is running, ask the update server
// once, fetch and reload when there is an update or a roll-back-to-embedded directive, and settle. Every phase goes to
// <documents>/spike-ota.json (iOS reads it) and to one "SPIKE_OTA {json}" log line (Android reads logcat).
// A launch that follows our own reload never fetches again, so a persistent directive cannot loop.
import * as Updates from 'expo-updates';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { OTA_FILE, OTA_RELOAD_FILE, clearResult, readResult, writeResult } from '../../adapters/resultFile';

type Phase = 'launch' | 'fetched' | 'settled';
type Check = { isAvailable: boolean; isRollBackToEmbedded: boolean; reason?: string };
type Result = {
  phase: Phase;
  running: { updateId: string | null; isEmbeddedLaunch: boolean; runtimeVersion: string | null; channel: string | null; mark: string | null };
  check?: Check;
  error?: string;
  logs?: string[];
};

/** Drives one OTA check per launch and reports each phase (see the file header). */
export function OtaScreen() {
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    const running = {
      updateId: Updates.updateId,
      isEmbeddedLaunch: Updates.isEmbeddedLaunch,
      runtimeVersion: Updates.runtimeVersion,
      channel: Updates.channel,
      mark: process.env.EXPO_PUBLIC_OTA_MARK ?? null, // inlined at bundle time: embedded, A or B in the smoke run
    };
    const publish = async (r: Result) => {
      const full = { ...r, logs: (await Updates.readLogEntriesAsync(60_000).catch(() => [])).slice(-20).map((e) => e.message) };
      setResult(full);
      console.log('SPIKE_OTA ' + JSON.stringify(full));
      await writeResult(OTA_FILE, full).catch(() => undefined);
    };
    (async () => {
      const reloaded = !!(await readResult(OTA_RELOAD_FILE).catch(() => null));
      clearResult(OTA_RELOAD_FILE);
      await publish({ phase: 'launch', running });
      try {
        const c = await Updates.checkForUpdateAsync();
        const check: Check = { isAvailable: c.isAvailable, isRollBackToEmbedded: c.isRollBackToEmbedded, reason: c.reason };
        if (!reloaded && (c.isAvailable || c.isRollBackToEmbedded)) {
          await Updates.fetchUpdateAsync();
          await publish({ phase: 'fetched', running, check });
          await writeResult(OTA_RELOAD_FILE, { at: Date.now() });
          await Updates.reloadAsync();
          return;
        }
        await publish({ phase: 'settled', running, check });
      } catch (e) {
        // A bad signature surfaces here (the tampered-update step).
        await publish({ phase: 'settled', running, error: String(e).slice(0, 500) });
      }
    })();
  }, []);

  return (
    <View style={styles.root}>
      <Text style={styles.mark}>{result?.running.mark ?? '...'}</Text>
      <Text style={styles.line}>phase {result?.phase ?? 'starting'}</Text>
      <Text style={styles.line}>embedded {String(result?.running.isEmbeddedLaunch)}</Text>
      <Text style={styles.line}>update {result?.running.updateId ?? 'none'}</Text>
      <Text style={styles.line}>{result?.error ?? result?.check?.reason ?? ''}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 48, justifyContent: 'center', backgroundColor: '#fff' },
  mark: { fontSize: 120, fontWeight: '700' },
  line: { fontSize: 28, marginTop: 12 },
});
