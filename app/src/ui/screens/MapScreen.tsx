import { useLayoutEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { StripColumnKind } from '../../domain/types';
import { MapSurface } from '../map/MapSurface';
import { appStore } from '../state/appStore';
import { StripColumn, type StripScreen } from '../StripColumn';

export const STRIP_WIDTH_PT = 400; // matches the SwiftUI strip (docs/DESIGN.md)

/** The strip column and selected airport each capture route opens with (the fidelity gate's screens). */
const OPENS_WITH: Record<StripScreen, { stripColumn: StripColumnKind; selectedAirportId: string | null }> = {
  map: { stripColumn: 'log', selectedAirportId: null },
  night: { stripColumn: 'log', selectedAirportId: null },
  airport: { stripColumn: 'airport', selectedAirportId: 'KSQL' },
  layers: { stripColumn: 'layers', selectedAirportId: null },
  nearest: { stripColumn: 'nearest', selectedAirportId: null },
  search: { stripColumn: 'search', selectedAirportId: null },
};

/**
 * The map-first layout: strip column beside the chart. A capture route passes `screen`, which decides what the strip
 * opens with and whether it is night; without it the strip just follows the app store.
 */
export function MapScreen({ screen }: { screen?: StripScreen }) {
  // After the first commit but before paint (a layout effect): writing the store during render would update the strip of
  // a route that is still mounted, which React flags in development. After that the strip follows the store, so the Log
  // back button and the footer toggles work in a dev build.
  useLayoutEffect(() => {
    if (screen) appStore.setState(OPENS_WITH[screen]);
  }, [screen]);
  const { width } = useWindowDimensions();
  const stripWidth = width < 600 ? 104 : STRIP_WIDTH_PT; // iPhone rail is 104pt; the spike targets iPad
  return (
    <SafeAreaProvider>
      <View style={styles.row}>
        <StripColumn screen={screen} width={stripWidth} />
        <View style={styles.map}>
          <MapSurface night={screen === 'night'} />
        </View>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row' },
  map: { flex: 1 },
});
