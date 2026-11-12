// Settings > Charts > Offline Maps (OfflineMapsView.swift), compact: sectional areas to download with the size estimate,
// current packs with progress and pause / resume / delete, storage used and the last error. Navigation is I1.
import { ScrollView, Text, View } from 'react-native';
import { CONTIGUOUS_US_SECTIONAL_AREAS, type OfflineRegionBounds } from '../../domain/offline/bounds';
import { estimatedBytesForLayers, formatOfflineSize, layerDetailDescription, OFFLINE_LAYERS } from '../../domain/offline/layers';
import type { OfflineMapService } from '../../domain/offline/offlineMapService';
import { offlinePackRow } from '../../domain/offline/rows';
import { Pressy, SectionBand, useTheme } from '../Primitives';
import { Space, Type } from '../tokens';
import { useOfflineMaps } from './useOfflineMaps';

export function OfflineMapsView({ service, visibleRegion, now = Date.now }: { service: OfflineMapService; visibleRegion?: OfflineRegionBounds | null; now?: () => number }) {
  const theme = useTheme();
  const { packs, storageUsedBytes, lastError } = useOfflineMaps(service);
  const row = { paddingVertical: Space.m, paddingHorizontal: Space.l };
  const act = (label: string, onPress: () => void) => (
    <Pressy accessibilityLabel={label} onPress={onPress} style={{ paddingVertical: Space.s, paddingHorizontal: Space.m }}>
      <Text style={[Type.label, { color: theme.accent }]}>{label}</Text>
    </Pressy>
  );
  return (
    <ScrollView style={{ backgroundColor: theme.paper }}>
      {lastError ? (
        <Pressy accessibilityLabel="Dismiss error" onPress={() => service.clearError()} style={row}>
          <Text style={[Type.body, { color: theme.warning }]}>{lastError.kind === 'chartDownloadFailed' ? lastError.region : lastError.kind}</Text>
        </Pressy>
      ) : null}
      <SectionBand title="Downloaded" detail={formatOfflineSize(storageUsedBytes)} />
      {packs.map((p) => {
        const r = offlinePackRow(p, now());
        return (
          <View key={r.id} style={[row, { flexDirection: 'row', alignItems: 'center' }]}>
            <View style={{ flex: 1 }}>
              <Text style={[Type.body, { color: theme.ink }]}>{r.title}</Text>
              <Text style={[Type.caption, { color: theme.inkSecondary }]}>{r.subtitle}</Text>
            </View>
            {r.action === 'pause' ? act('Pause', () => void service.pause(p)) : null}
            {r.action === 'resume' ? act('Resume', () => void service.resume(p)) : null}
            {r.action === 'redownload' ? act('Redownload', () => void service.redownload(p)) : null}
            {act('Delete', () => void service.delete(p))}
          </View>
        );
      })}
      <SectionBand title="Download" detail={OFFLINE_LAYERS.map(layerDetailDescription)[0]} />
      {visibleRegion
        ? (
            <Pressy accessibilityLabel="Download current map view" style={row} onPress={() => void service.download('Map view', visibleRegion, [...OFFLINE_LAYERS]).catch(() => undefined)}>
              <Text style={[Type.body, { color: theme.ink }]}>Current map view</Text>
              <Text style={[Type.caption, { color: theme.inkSecondary }]}>{formatOfflineSize(estimatedBytesForLayers(visibleRegion, OFFLINE_LAYERS))}</Text>
            </Pressy>
          )
        : null}
      {CONTIGUOUS_US_SECTIONAL_AREAS.map((a) => (
        <Pressy key={a.name} accessibilityLabel={`Download ${a.name}`} style={row} onPress={() => void service.download(a.name, a.bounds, [...OFFLINE_LAYERS]).catch(() => undefined)}>
          <Text style={[Type.body, { color: theme.ink }]}>{a.name}</Text>
          <Text style={[Type.caption, { color: theme.inkSecondary }]}>{formatOfflineSize(estimatedBytesForLayers(a.bounds, OFFLINE_LAYERS))}</Text>
        </Pressy>
      ))}
    </ScrollView>
  );
}
