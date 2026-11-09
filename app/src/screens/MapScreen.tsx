import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { MapSurface } from '../map/MapSurface';
import { StripColumn, type StripScreen } from '../ui/StripColumn';

export const STRIP_WIDTH_PT = 400; // matches the SwiftUI strip (docs/DESIGN.md)

export function MapScreen({ screen }: { screen: StripScreen }) {
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
