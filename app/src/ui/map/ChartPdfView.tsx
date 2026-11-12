// Views/Map/ChartPDFView.swift: a terminal chart PDF with a loading state, an error state with Retry, and the cycle expiry
// banner. Fit-to-width and pinch zoom (up to 8x the fit scale, as Swift) come from react-native-pdf. The PDF is fetched by
// the chart-pack service behind `ChartPdfSource` (see domain/diagram/pdfChart.ts, reconcile with S1c).
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import Pdf from 'react-native-pdf';
import { expiryBanner, PdfChartController, type ChartPdfSource, type PdfChartRef } from '../../domain/diagram/pdfChart';
import { Pressy, useTheme } from '../Primitives';
import { Space, Type } from '../tokens';

export function ChartPdfView({ chart, source, now = Date.now }: { chart: PdfChartRef; source: ChartPdfSource; now?: () => number }) {
  const theme = useTheme();
  const controller = useMemo(() => new PdfChartController(source, chart), [source, chart]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    void controller.load();
    return () => controller.dispose();
  }, [controller]);

  if (state.kind === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.m, backgroundColor: theme.paper }}>
        <ActivityIndicator />
        <Text style={[Type.caption, { color: theme.inkSecondary }]}>Downloading chart...</Text>
      </View>
    );
  }
  if (state.kind === 'failed') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.m, padding: Space.l, backgroundColor: theme.paper }}>
        <Text style={[Type.body, { color: theme.caution, textAlign: 'center' }]}>{state.message}</Text>
        <Pressy accessibilityLabel="Retry" onPress={() => void controller.load()}>
          <Text style={[Type.label, { color: theme.accent }]}>Retry</Text>
        </Pressy>
      </View>
    );
  }
  const banner = expiryBanner(chart.cycle, source.cycleExpiry(chart.cycle), now());
  return (
    <View style={{ flex: 1, backgroundColor: theme.paper }}>
      {banner ? (
        <View accessibilityLabel="chart-expiry-banner" style={{ padding: Space.m, backgroundColor: theme.paperSecondary }}>
          <Text style={[Type.systemFootnoteSemibold, { color: banner.severity === 'warning' ? theme.warning : theme.caution }]}>{banner.text}</Text>
        </View>
      ) : null}
      <Pdf
        source={{ uri: state.uri }}
        style={{ flex: 1 }}
        fitPolicy={0}
        minScale={1}
        maxScale={8}
        onError={() => controller.openFailed()}
      />
    </View>
  );
}
