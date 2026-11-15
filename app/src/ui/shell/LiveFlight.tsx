import { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { describeError } from '../../domain/describeError';
import { Pressy, useTheme } from '../Primitives';
import type { FlightRecord } from '../../data/models';
import { DebriefScreen } from '../flights/DebriefScreen';
import { FlightDetailScreen } from '../flights/FlightDetailScreen';
import { ReplayScreen } from '../replay/ReplayScreen';
import type { RecordingViewStore } from '../state/recordingStore';
import type { FlightScreenStores } from './flightScreens';

type Page = 'detail' | 'debrief' | 'replay';

/**
 * One recorded flight and the screens pushed from it (LogRoute.flight -> FlightDetailView -> ReplayView / DebriefView): the
 * flight is read, its stores are built once, and Back walks the small stack. Nothing shows until the flight has loaded.
 */
export function LiveFlight({
  flightId,
  load,
  build,
  recording,
  databaseOpened,
  onClose,
}: {
  flightId: string;
  load: (flightId: string) => Promise<FlightRecord | null>;
  build: (flight: FlightRecord) => FlightScreenStores;
  recording: RecordingViewStore;
  databaseOpened: boolean;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<{ flight: FlightRecord; stores: FlightScreenStores } | null>(null);
  const [page, setPage] = useState<Page>('detail');
  // A read that rejects is not a deleted flight: say so and let the pilot try again (null still means deleted).
  const [failure, setFailure] = useState<{ message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let built: FlightScreenStores | null = null;
    load(flightId)
      .then((flight) => {
        if (cancelled) return;
        if (!flight) return onClose(); // deleted meanwhile: back to the log
        built = build(flight);
        setLoaded({ flight, stores: built });
      })
      .catch((error) => {
        console.warn(`Flight ${flightId} could not be loaded: ${describeError(error)}`);
        if (!cancelled) setFailure({ message: describeError(error) });
      });
    return () => {
      cancelled = true;
      built?.dispose();
    };
    // One flight per mount: the callbacks are stable for the life of the runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flightId, attempt]);
  if (failure && !loaded)
    return (
      <LoadFailure
        message={failure.message}
        onRetry={() => {
          setFailure(null);
          setAttempt((n) => n + 1);
        }}
        onClose={onClose}
      />
    );
  if (!loaded) return null;
  const { flight, stores } = loaded;
  const back = () => setPage('detail');
  if (page === 'debrief' && stores.debrief) return <DebriefScreen store={stores.debrief} onBack={back} />;
  if (page === 'replay')
    return <ReplayScreen flight={flight} store={stores.replay} recording={recording} onBack={back} />;
  return (
    <FlightDetailScreen
      flight={flight}
      store={stores.detail}
      recording={recording}
      databaseOpened={databaseOpened}
      navigation={{
        onBack: onClose,
        onOpenReplay: () => setPage('replay'),
        onOpenDebrief: () => setPage('debrief'),
        onOpenSettings: () => void Linking.openSettings(),
      }}
    />
  );
}

function LoadFailure({ message, onRetry, onClose }: { message: string; onRetry: () => void; onClose: () => void }) {
  const t = useTheme();
  return (
    <View
      style={{ flex: 1, backgroundColor: t.paper, padding: 24, gap: 12, justifyContent: 'center' }}
      testID="flight-load-failed"
    >
      <Text style={{ color: t.ink, fontSize: 17, fontWeight: '600' }}>This flight could not be opened</Text>
      <Text style={{ color: t.secondaryText, fontSize: 15 }}>{message}</Text>
      <Pressy
        accessibilityLabel="Try again"
        onPress={onRetry}
        testID="flight-load-retry"
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Text style={{ color: t.accent, fontSize: 17 }}>Try again</Text>
      </Pressy>
      <Pressy
        accessibilityLabel="Back"
        onPress={onClose}
        testID="flight-load-close"
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Text style={{ color: t.accent, fontSize: 17 }}>Back</Text>
      </Pressy>
    </View>
  );
}
