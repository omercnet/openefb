import { useMemo } from 'react';
import { Modal, SafeAreaView, Text, View } from 'react-native';
import { categoryForChartCode } from '../../services/terminal/dtpp';
import { createTerminalPdfSource } from '../../adapters/terminalPdfSource';
import type { TerminalProcedureServiceLike } from '../../services/terminal/terminalProcedureService';
import { ChartPdfView } from '../map/ChartPdfView';
import { Pressy, useTheme } from '../Primitives';
import { useAppStore, appStore } from '../state/appStore';
import { Space, Type } from '../tokens';

/** ChartPDFView full screen over the app: the chart the airport column opened, with Done. */
export function ChartViewer({ terminal }: { terminal: Pick<TerminalProcedureServiceLike, 'pdfPath'> }) {
  const theme = useTheme();
  const chart = useAppStore((s) => s.chartViewer);
  const source = useMemo(() => createTerminalPdfSource(terminal), [terminal]);
  const ref = useMemo(() => (chart ? { ...chart, category: categoryForChartCode(chart.chartCode) } : null), [chart]);
  const close = () => appStore.getState().openChartViewer(null);
  return (
    <Modal visible={chart !== null} animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.paper }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: Space.m, gap: Space.m }}>
          <Text numberOfLines={1} style={[Type.title, { flex: 1, color: theme.ink }]} testID="chart-viewer-title">
            {chart?.name ?? ''}
          </Text>
          <Pressy accessibilityRole="button" accessibilityLabel="Done" onPress={close} testID="chart-viewer-done">
            <Text style={[Type.title, { color: theme.accent }]}>Done</Text>
          </Pressy>
        </View>
        {ref ? <ChartPdfView chart={ref} source={source} /> : null}
      </SafeAreaView>
    </Modal>
  );
}
