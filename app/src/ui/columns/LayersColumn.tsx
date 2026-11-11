// LayersColumn (efb-212/Views/Log/LayersColumnView.swift): map layers in the strip column, opened from the LAYERS
// footer cell: display (day / night / auto), orientation, the map-screen panels, the sectional with its opacity,
// offline and cycle status, the Israel CVFR chart layers, and the data layers. Live-data layers (TFRs, AIRMET/SIGMET)
// show their data age while visible, or why they are not loaded with a Retry.
import { ScrollView, Text, View } from 'react-native';
import { evaluateFreshness } from '../../domain/core/freshness';
import { isLayerAvailable, regionSupports, unavailableReason } from '../../domain/core/region';
import { MAP_MODES, type MapLayer } from '../../domain/core/types';
import { DISPLAY_MODES, displayModeTitle } from '../../domain/displayMode';
import { DataAgeBadge, OpacitySlider } from '../components/Components';
import { WarningTriangle } from '../Icons';
import { ColumnRule, Pressy, SectionLabel, useTheme } from '../Primitives';
import { panels, type PanelsData } from '../state/panels';
import { useRegion } from '../state/region';
import { Space, StripMetrics, Type } from '../tokens';
import { ColumnHeader } from './ColumnHeader';
import { AgeLine, Caption, SegmentRow, ToggleRow, UnavailableRow } from './layers/controls';
import { cycleDateText, offlineStatusLabel, toggleLayer } from './layers/logic';
import { layers, type LayersData } from './layers/store';

const padded = { paddingHorizontal: Space.l };
/** IsraelLSAOverlay.routeColor. */
const LSA_ROUTE = '#8C38C7';
export function LayersColumn() {
  const t = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.paper }}>
      <ColumnHeader>
        <Text accessibilityRole="header" style={[Type.title, { color: t.ink }]}>
          Layers
        </Text>
      </ColumnHeader>
      <LayersBody />
    </View>
  );
}

function LayersBody() {
  const t = useTheme();
  const api = layers.useStoreApi();
  const s = layers.useData((d) => d);
  const panelsApi = panels.useStoreApi();
  const p = panels.useData((d) => d);
  const region = useRegion();
  const set = (patch: Partial<LayersData>) => api.setState(patch);
  const visible = (layer: MapLayer) => s.visibleLayers.includes(layer);
  const toggle = (layer: MapLayer) => set({ visibleLayers: toggleLayer(api.getState().visibleLayers, layer, region) });
  const available = (layer: MapLayer) => regionSupports(region, layer);
  const reason = unavailableReason(region);
  const layerRow = (layer: MapLayer, label: string, tint: string, inset = true) => (
    <ToggleRow label={label} value={visible(layer)} onChange={() => toggle(layer)} tint={tint} inset={inset} />
  );
  const panel = (key: keyof PanelsData, label: string, caption: string, testID: string) => (
    <View style={{ gap: 2 }}>
      <ToggleRow
        label={label}
        value={p[key]}
        onChange={(on) => panelsApi.setState({ [key]: on })}
        tint={t.accent}
        hint={caption}
        testID={testID}
        inset={false}
      />
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Caption text={caption} minScale={0.8} />
      </View>
    </View>
  );
  const dataLayer = (
    layer: MapLayer,
    label: string,
    tint: string,
    fetchedAt: number | null,
    failed: boolean,
    retry: () => void,
  ) => (
    <View style={[padded, { gap: 2 }]}>
      <ToggleRow label={label} value={visible(layer)} onChange={() => toggle(layer)} tint={tint} inset={false} />
      {!visible(layer) ? null : fetchedAt !== null ? (
        <AgeLine product={layer === 'tfrs' ? 'tfr' : 'airmetSigmet'} input={{ observed: fetchedAt, now: s.now }} />
      ) : failed ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Space.xs }}>
          <WarningTriangle color={t.caution} bang={t.paper} />
          <Caption text="Not loaded" color={t.caution} />
          <Pressy
            accessibilityLabel={`Retry ${label}`}
            onPress={retry}
            style={{
              minWidth: StripMetrics.cell,
              minHeight: StripMetrics.cell,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={[Type.labelBold, { color: t.accentText }]}>Retry</Text>
          </Pressy>
        </View>
      ) : (
        <Caption text={'Loading\u2026'} />
      )}
    </View>
  );
  const cycle =
    s.chartExpiration !== null ? evaluateFreshness('chartCycle', { validUntil: s.chartExpiration, now: s.now }) : null;

  return (
    <ScrollView contentContainerStyle={{ paddingVertical: Space.l, gap: Space.m }}>
      <View style={[padded, { gap: Space.s }]}>
        <SectionLabel title="Display" />
        <SegmentRow
          options={DISPLAY_MODES}
          selected={s.displayMode}
          title={displayModeTitle}
          onSelect={(displayMode) => set({ displayMode })}
          label="Display mode"
          testID="display-mode"
        />
      </View>
      <View style={[padded, { gap: Space.s }]}>
        <SectionLabel title="Orientation" />
        <SegmentRow
          options={MAP_MODES}
          selected={s.mapMode}
          title={(m) => (m === 'northUp' ? 'North up' : 'Track up')}
          onSelect={(mapMode) => set({ mapMode })}
          label="Map orientation"
          testID="Map orientation"
        />
      </View>

      {/* Panels: hide the flight log and the instruments to give the chart more room, and the airspace predictions. */}
      <View style={[padded, { gap: Space.xs }]}>
        <SectionLabel title="Panels" />
        {panel('showsFlightLog', 'Flight log', 'Strip with next and flown waypoints', 'toggle-flight-log')}
        {panel('showsInstruments', 'Instruments', 'Ground speed, track, altitude and the tape', 'toggle-instruments')}
        {panel(
          'showsPredictions',
          'Predictions (preview)',
          'Airspace ahead in the next 10 minutes, from track, speed and climb',
          'toggle-predictions',
        )}
      </View>
      <ColumnRule />

      <View style={[padded, { gap: Space.s }]}>
        <SectionLabel title="Sectional" />
        {available('sectional') ? (
          <>
            {layerRow('sectional', 'VFR sectional chart', t.layerSectional, false)}
            {visible('sectional') ? (
              <>
                <OpacitySlider
                  opacity={s.sectionalOpacity}
                  onChange={(sectionalOpacity) => set({ sectionalOpacity })}
                />
                {cycle ? (
                  <DataAgeBadge level={cycle.level} text={cycle.text} productName="Chart cycle" hideWhenFresh />
                ) : null}
              </>
            ) : null}
            <View style={{ gap: 2 }}>
              <Text
                testID="offline-status-line"
                style={[
                  Type.label,
                  {
                    color:
                      s.offlineStatus === 'expired' ? t.caution : s.offlineStatus === 'ready' ? t.ink : t.inkSecondary,
                  },
                ]}
              >
                {offlineStatusLabel(s.offlineStatus)}
              </Text>
              <Text testID="sectional-cycle-line" style={[Type.caption, { color: t.inkSecondary }]}>
                {`Sectional cycle: valid to ${cycleDateText(s.sectionalCycleExpires)}`}
              </Text>
            </View>
          </>
        ) : (
          <UnavailableRow label="VFR sectional chart" reason={reason} inset={false} />
        )}
      </View>
      <ColumnRule />

      {/* Israel CVFR chart (IL-3): the region's own chart, from the bundled CAAI data. */}
      {available('cvfrRoutes') ? (
        <>
          <View style={{ gap: Space.xs }}>
            <View style={padded}>
              <SectionLabel title="CVFR chart" />
            </View>
            {layerRow('cvfrRoutes', 'Routes and altitudes', t.layerWeather)}
            {layerRow('cvfrPoints', 'Reporting points', t.layerAirports)}
            {layerRow('cvfrAirspace', 'Airspace (CTR, TMA, P/R/D)', t.layerAdvisory)}
            {layerRow('cvfrRunways', 'Runways', t.layerDiagrams)}
            {layerRow('cvfrClosures', 'NOTAM route closures', t.warning)}
            {layerRow('lsaRoutes', 'Sport-aviation (LSA) routes', LSA_ROUTE)}
            {visible('cvfrClosures') ? <ClosureStatusRow status={s.closureStatus} now={s.now} /> : null}
          </View>
          <ColumnRule />
        </>
      ) : null}

      <View style={padded}>
        <SectionLabel title="Data layers" />
      </View>
      {available('airports') ? (
        layerRow('airports', 'Airports', t.layerAirports)
      ) : (
        <UnavailableRow label="Airports" reason={reason} />
      )}
      {available('airspace') ? (
        layerRow('airspace', 'Airspace', t.layerAirspace)
      ) : (
        <UnavailableRow label="Airspace" reason={reason} />
      )}
      {available('tfrs') ? (
        dataLayer('tfrs', 'TFRs', t.warning, s.tfrFetchedAt, s.tfrLoadFailed, s.retryTfrs)
      ) : (
        <UnavailableRow label="TFRs" reason={reason} />
      )}
      {available('advisories') ? (
        dataLayer(
          'advisories',
          'AIRMET/SIGMET',
          t.layerAdvisory,
          s.advisoriesFetchedAt,
          s.advisoriesLoadFailed,
          s.retryAdvisories,
        )
      ) : (
        <UnavailableRow label="AIRMET/SIGMET" reason={reason} />
      )}
      {layerRow('weatherDots', 'Weather', t.layerWeather)}
      {/* Weather data age (staleness on every weather surface), indented under the toggle. */}
      {visible('weatherDots') && s.oldestWeatherObservation !== null ? (
        <AgeLine
          product="metar"
          input={{ observed: s.oldestWeatherObservation, now: s.now }}
          style={{ paddingLeft: 52 }}
        />
      ) : null}
      {available('navaids') ? (
        layerRow('navaids', 'Navaids', t.layerAdvisory)
      ) : (
        <UnavailableRow label="Navaids" reason={reason} />
      )}
      {isLayerAvailable(region, 'airportDiagrams') || isLayerAvailable(region, 'israelDiagrams') ? (
        <View style={[padded, { gap: 2 }]}>
          <ToggleRow
            label="Airport diagrams"
            value={s.airportDiagrams}
            onChange={(airportDiagrams) => set({ airportDiagrams })}
            tint={t.layerDiagrams}
            inset={false}
          />
          <Caption
            text={
              region === 'israel'
                ? 'Advisory. Verify against the CAAI diagram.'
                : 'Advisory. Verify against the FAA diagram.'
            }
          />
        </View>
      ) : (
        <UnavailableRow label="Airport diagrams" reason={reason} />
      )}
    </ScrollView>
  );
}

/**
 * Age of the NOTAM feed behind the closures, or why nothing is drawn. Old data is never drawn as current: past the
 * NOTAM limit the layer shows nothing and says so.
 */
function ClosureStatusRow({ status, now }: { status: LayersData['closureStatus']; now: number }) {
  const t = useTheme();
  if (status.kind === 'noFeed') {
    return (
      <View style={[padded, { flexDirection: 'row', alignItems: 'center', gap: Space.xs }]}>
        <WarningTriangle color={t.caution} bang={t.paper} />
        <Caption text="No NOTAM feed: closures not shown" color={t.caution} />
      </View>
    );
  }
  const drawable = status.level === 'fresh' || status.level === 'old';
  return (
    <View style={[padded, { flexDirection: 'row', alignItems: 'center', gap: Space.xs }]}>
      <AgeLine product="notam" input={{ observed: status.generatedAt, now }} />
      {drawable ? (
        <Caption text={`${status.closed} segment${status.closed === 1 ? '' : 's'} closed`} />
      ) : (
        <Caption text="Too old: closures hidden" color={t.caution} />
      )}
    </View>
  );
}
