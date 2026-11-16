// The CVFR chart sheet over the map (MapContainerView's `.sheet(item: israelChart.selection)`): a tapped reporting point or the
// airspaces under the finger. The sheet's content is sheets/israelChart; this presents it like the NOTAM briefing.
import { useFonts } from 'expo-font';
import { View } from 'react-native';
import type { IsraelChartSelection } from '../../domain/map/israel';
import { BriefingPresentation } from '../sheets/briefing/BriefingPresentation';
import { IsraelChartSheet } from '../sheets/israelChart/IsraelChartSheet';
import { FontFiles } from '../tokens';

/** What the map can hand the sheet: an aerodrome tap opens the airport column instead. */
export type ChartSheetSelection = Exclude<IsraelChartSelection, { kind: 'aerodrome' }>;

export function IsraelChartSheetHost({
  selection,
  onClose,
}: {
  selection: ChartSheetSelection | null;
  onClose: () => void;
}) {
  const [fontsLoaded, fontError] = useFonts(FontFiles);
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}>
      <BriefingPresentation presented={selection !== null} onDismiss={onClose}>
        {selection && (fontsLoaded || fontError != null) ? (
          <IsraelChartSheet selection={selection} onClose={onClose} />
        ) : null}
      </BriefingPresentation>
    </View>
  );
}
