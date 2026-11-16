// Settings and what it opens (SettingsView and its NavigationStack destinations): Aircraft & Pilot, the aircraft and pilot
// editors, the night landing sheet, Offline Maps and the disclaimers. The stack is local: Back pops a page, and Back from
// the first page closes Settings (the Log's settings button opens it as an overlay over the log).
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import type { OfflineMapService } from '../../domain/offline/offlineMapService';
import type { OfflineRegionBounds } from '../../domain/offline/bounds';
import { NavBar } from '../form/Form';
import { OfflineMapsView } from '../map/OfflineMapsView';
import { useTheme } from '../Primitives';
import { AircraftEditScreen } from '../screens/AircraftEditScreen';
import { AircraftListScreen } from '../screens/AircraftListScreen';
import { DisclaimersScreen } from '../screens/DisclaimersScreen';
import { NightLandingScreen, PilotEditScreen } from '../screens/PilotEditScreen';
import { PilotProfileScreen } from '../screens/PilotProfileScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import type { SettingsServices } from '../state/settingsStore';
import type { AircraftStore } from '../state/aircraftStore';
import type { PilotStore } from '../state/pilotStore';

export type SettingsPage =
  | { page: 'settings' }
  | { page: 'aircraft' }
  | { page: 'aircraftEdit'; id: string | null }
  | { page: 'pilot' }
  | { page: 'pilotEdit'; id: string }
  | { page: 'nightLanding' }
  | { page: 'offline' }
  | { page: 'disclaimers' };

export function LiveSettings({
  services,
  aircraft,
  pilot,
  offline,
  mapBounds,
  openURL,
  onClose,
}: {
  /** Must keep its identity while Settings is open. */
  services: SettingsServices;
  aircraft: AircraftStore;
  pilot: PilotStore;
  offline: OfflineMapService;
  /** The map's visible area, for "download this view". */
  mapBounds: () => OfflineRegionBounds | null;
  openURL?: (url: string) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [stack, setStack] = useState<SettingsPage[]>([{ page: 'settings' }]);
  const push = (page: SettingsPage) => setStack((s) => [...s, page]);
  const pop = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  const top = stack[stack.length - 1]!;
  const now = services.now;

  const screen = useMemo(() => {
    switch (top.page) {
      case 'settings':
        return (
          <SettingsScreen
            services={services}
            navigation={{
              onBack: onClose,
              onOpenProfiles: () => push({ page: 'aircraft' }),
              onOpenOfflineMaps: () => push({ page: 'offline' }),
              onOpenDisclaimers: () => push({ page: 'disclaimers' }),
              openURL,
            }}
          />
        );
      case 'aircraft':
        return (
          <AircraftListScreen
            store={aircraft}
            navigation={{
              onBack: pop,
              onAdd: () => push({ page: 'aircraftEdit', id: null }),
              onEdit: (id) => push({ page: 'aircraftEdit', id }),
              onOpenPilot: () => push({ page: 'pilot' }),
            }}
          />
        );
      case 'aircraftEdit':
        return <AircraftEditScreen store={aircraft} profileId={top.id} now={now} onClose={pop} />;
      case 'pilot':
        return (
          <PilotProfileScreen
            store={pilot}
            navigation={{
              onBack: pop,
              onEdit: (id) => push({ page: 'pilotEdit', id }),
              onLogNightLandings: () => push({ page: 'nightLanding' }),
            }}
          />
        );
      case 'pilotEdit':
        return <PilotEditScreen store={pilot} profileId={top.id} now={now} onClose={pop} />;
      case 'nightLanding':
        return <NightLandingScreen store={pilot} now={now} onClose={pop} />;
      case 'offline':
        return (
          <View style={{ flex: 1, backgroundColor: t.paper }} testID="offline-maps-screen">
            <NavBar title="Offline Maps" onBack={pop} />
            <OfflineMapsView service={offline} visibleRegion={mapBounds() ?? undefined} />
          </View>
        );
      case 'disclaimers':
        return <DisclaimersScreen onBack={pop} />;
    }
    // The stack is the only thing that changes which page shows; the callbacks are stable for the life of Settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top]);
  return <>{screen}</>;
}
