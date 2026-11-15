import { useEffect, useState } from 'react';
import { Linking } from 'react-native';
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
      .catch(() => !cancelled && onClose());
    return () => {
      cancelled = true;
      built?.dispose();
    };
    // One flight per mount: the callbacks are stable for the life of the runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flightId]);
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
