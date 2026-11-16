import { StyleSheet, View } from 'react-native';
import type { MapLayer } from '../../domain/core';
import { ISRAEL_OFFICIAL_CHART_SOURCE_ID, israelOfficialChartOverrides } from '../../domain/map/israel/layers';
import { withIsraelOfficialChart } from '../../domain/map/israel/officialChart';
import type { OfficialChart } from './useOfficialChart';
import type { MapTap } from './mapTap';
import type { DiagramSources } from '../../domain/diagram/layers';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { layerSpecsFor } from '../../domain/map/registry';
import { useLocalGlyphs } from '../../adapters/glyphInstall';
import { CompactMapLayout } from '../CompactMapLayout';
import { useWidthClass, usesCompactLayout } from '../layout';
import { NightContext } from '../state/night';
import { panels } from '../state/panels';
import { StripColumn, type StripScreen } from '../StripColumn';
import { StripMetrics } from '../tokens';
import { MapSurface } from './MapSurface';
import { REMOTE_GLYPHS_URL } from './surfaceModel';
import type { useMapModel } from './useMapData';

/**
 * The map-first layout (MapContainerView.swift): on a regular window the 400pt strip column beside the chart; on a
 * compact window (iPhone, narrow Split View) or with the flight log hidden, the compact layout with the 104pt NEXT rail
 * and NOW and the footer under the chart. The data (`model`) comes from the live app or from a capture route's fixtures.
 */
export function MapLayout({
  screen,
  night = false,
  liveNight,
  sectional = true,
  sectionalOpacity,
  model,
  initialView,
  diagrams,
  official,
  onMapPress,
}: {
  screen?: StripScreen;
  night?: boolean;
  /** The live app's resolved display mode; the strip then follows it instead of the capture screen. */
  liveNight?: boolean;
  sectional?: boolean;
  sectionalOpacity?: number;
  model: ReturnType<typeof useMapModel>;
  initialView: { center: { lat: number; lon: number }; zoom: number };
  /** The airport diagram overlay's sources: backing polygons, images and forced layer visibility (live app only). */
  diagrams?: DiagramSources;
  /** The installed official CAAI chart (Israel): the base raster, with the vector duplicates hidden. */
  official?: OfficialChart;
  /** A tap on the map (live app only). */
  onMapPress?: (tap: MapTap) => void;
}) {
  const { widthClass, width } = useWidthClass();
  const showsFlightLog = panels.useData((s) => s.showsFlightLog);
  const glyphs = useLocalGlyphs();
  if (glyphs.status === 'failed') console.warn('local glyph install failed; labels need a network', glyphs.error);

  const chart =
    glyphs.status === 'loading' ? null : (
      <View
        style={{ flex: 1 }}
        onLayout={(e) => model.onMapLayout({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      >
      <MapSurface
        night={night}
        glyphsUrl={glyphs.status === 'ready' ? glyphs.url : REMOTE_GLYPHS_URL}
        sectional={sectional}
        sectionalOpacity={sectionalOpacity}
        region={model.snapshot.region}
        visibleLayers={model.snapshot.visibleLayers}
        layers={withIsraelOfficialChart(layerSpecsFor(model.snapshot.region), official?.present ?? false)}
        sources={diagrams ? { ...model.sources, ...diagrams.geojson } : model.sources}
        imageSources={diagrams?.images}
        rasterSources={official?.url ? { [ISRAEL_OFFICIAL_CHART_SOURCE_ID]: { url: official.url } } : undefined}
        overrides={overridesFor(diagrams, official?.present ?? false, model.snapshot.visibleLayers, night)}
        initialView={initialView}
        camera={model.camera}
        onViewChange={model.onViewChange}
        onMapPress={onMapPress}
        onStyleLoaded={model.onStyleLoaded}
        onTileHealth={model.onTileHealth}
      />
      </View>
    );
  return (
    <NightContext.Provider value={liveNight ?? null}>
    <SafeAreaProvider>
      {usesCompactLayout(widthClass, showsFlightLog) ? (
        <CompactMapLayout screen={screen} width={width} compact={widthClass === 'compact'} chart={chart} />
      ) : (
        <View style={styles.row}>
          <StripColumn screen={screen} width={StripMetrics.width} />
          <View style={styles.map}>{chart}</View>
        </View>
      )}
    </SafeAreaProvider>
    </NightContext.Provider>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row' },
  map: { flex: 1 },
});

/** The diagram overlay's forced layer visibility and the official chart's overrides (hidden duplicates, tap targets), merged. */
function overridesFor(
  diagrams: DiagramSources | undefined,
  officialPresent: boolean,
  visible: ReadonlySet<MapLayer>,
  night: boolean,
) {
  const official = israelOfficialChartOverrides(officialPresent, visible, night);
  if (!diagrams && !officialPresent) return undefined;
  return { visibility: { ...diagrams?.visibility, ...official.visibility }, paint: official.paint };
}
