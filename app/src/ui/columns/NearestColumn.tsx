// NearestColumnView (efb-212/Views/Log/NearestColumnView.swift): the nearest landable airports in the strip column,
// opened from the NRST footer cell. Each row: ident, name, longest runway, caution tags, distance and bearing, and a large
// "Direct" action that starts Direct-To and returns to the log. Tapping the row body opens the airport column.
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { DEFAULT_MINIMUM_RUNWAY_LENGTH_FEET, hasAirportData, regionDisplayName, type Airport } from '../../domain/core';
import { Airplane, ArrowUpRight } from '../Icons';
import { ColumnRule, Pressy, useTheme } from '../Primitives';
import { appStore } from '../state/appStore';
import { Space, StripMetrics, Type } from '../tokens';
import { ColumnHeader } from './ColumnHeader';
import {
  bearingText,
  cautionTags,
  distanceText,
  entryLongestRunway,
  rowRunwayText,
  type NearestAirportEntry,
} from './nearest/logic';
import { useNearestAirports } from './nearest/refresh';
import { CautionTags } from './nearest/StatusTag';
import { nearest } from './nearest/store';

export interface NearestColumnProps {
  /** Start Direct-To; the column then returns the strip to the log. Defaults to the store's `directTo`. */
  onDirectTo?: (airport: Airport) => void;
  /** Open the airport column. Defaults to `appStore.showAirport`. */
  onAirportTap?: (icao: string) => void;
}

export function NearestColumn({ onDirectTo, onAirportTap = appStore.getState().showAirport }: NearestColumnProps = {}) {
  const t = useTheme();
  const { entries, loading, error, region } = useNearestAirports();
  const storeDirectTo = nearest.useData((s) => s.directTo);
  const directTo = (airport: Airport) => {
    (onDirectTo ?? storeDirectTo)(airport);
    appStore.getState().setStripColumn('log');
  };
  const name = regionDisplayName(region);
  let body;
  if (!hasAirportData(region)) {
    // Never an empty list that reads as "no airports nearby".
    body = (
      <Unavailable
        title={`No airport data for ${name} yet`}
        detail={`Nearest airports need ${name} airport data, which is not installed yet. Weather stations are on the map.`}
      />
    );
  } else if (entries.length === 0 && error !== null) {
    body = (
      // The raw error stays in the store for diagnostics; the pilot gets plain words.
      <Unavailable
        title="Nearest airports unavailable"
        detail="The airport database could not be read. The list updates at the next position fix."
      />
    );
  } else if (entries.length === 0 && loading) {
    body = (
      <View accessible accessibilityLabel="Finding nearest airports" style={{ padding: Space.l, alignItems: 'center' }}>
        <ActivityIndicator color={t.inkSecondary} />
      </View>
    );
  } else if (entries.length === 0) {
    body = (
      <Unavailable
        title="No landable airport in range"
        detail={`Heliports, seaplane bases and runways under ${DEFAULT_MINIMUM_RUNWAY_LENGTH_FEET} ft are not listed.`}
      />
    );
  } else {
    body = (
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {error !== null ? (
          <Text
            accessibilityRole="alert"
            style={[Type.caption, { color: t.warning, paddingHorizontal: Space.l, paddingVertical: Space.s }]}
          >
            Could not refresh: showing the last list
          </Text>
        ) : null}
        {entries.map((entry) => (
          <View key={entry.airport.icao}>
            <NearestRow entry={entry} onDirectTo={directTo} onAirportTap={onAirportTap} />
            <ColumnRule />
          </View>
        ))}
      </ScrollView>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: t.paper }}>
      <ColumnHeader>
        <Text accessibilityRole="header" style={[Type.title, { color: t.ink }]}>
          Nearest
        </Text>
      </ColumnHeader>
      {body}
    </View>
  );
}

function NearestRow({
  entry,
  onDirectTo,
  onAirportTap,
}: {
  entry: NearestAirportEntry;
  onDirectTo: (airport: Airport) => void;
  onAirportTap: (icao: string) => void;
}) {
  const t = useTheme();
  const { icao, name } = entry.airport;
  const runway = rowRunwayText(entry);
  const hasRunway = entryLongestRunway(entry) !== null;
  const tags = cautionTags(entry);
  const distance = distanceText(entry.distance);
  const bearing = bearingText(entry.bearing);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: Space.m,
        paddingHorizontal: Space.l,
        paddingVertical: Space.s,
        minHeight: StripMetrics.cell + Space.s,
      }}
    >
      {/* Airport identity and runway (tap for airport info) */}
      <Pressy
        accessibilityLabel={[icao, name, runway, ...tags.map((tag) => tag.spoken)].join(', ')}
        accessibilityHint="Shows airport information"
        testID={`nearest-row-${icao}`}
        onPress={() => onAirportTap(icao)}
        style={{ flex: 1, gap: Space.xs }}
      >
        {/* .lineLimit(1).fixedSize(): in a row of its own the ident is laid out on the horizontal axis, where flexShrink 0
            keeps its natural width (it overflows rather than wraps; idents are at most 7 characters). */}
        <View style={{ flexDirection: 'row' }}>
          <Text style={[Type.rowIdent, { color: t.airspace, flexShrink: 0 }]}>{icao}</Text>
        </View>
        {/* One line, tail-truncated; Hebrew (right-to-left) names stay on the leading edge of the row. */}
        <Text numberOfLines={1} ellipsizeMode="tail" style={[Type.body, { color: t.inkSecondary, textAlign: 'left' }]}>
          {name}
        </Text>
        {/* iOS's line breaking pushes a would-be orphan word down ("10R/28L" / "5,694' ASPH"): keep length and surface together. */}
        <Text style={[Type.data, { color: hasRunway ? t.ink : t.inkSecondary }]}>
          {hasRunway ? runway.replace(/ (\S+)$/, '\u00A0$1') : runway}
        </Text>
        {tags.length > 0 ? <CautionTags tags={tags} testID={`nearest-tags-${icao}`} /> : null}
      </Pressy>
      {/* Distance (NM) and bearing (degrees) */}
      <View accessible accessibilityLabel={`${distance}, ${bearing}`} style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text numberOfLines={1} style={[Type.dataEmphasis, { color: t.ink }]}>
          {distance}
        </Text>
        <Text numberOfLines={1} style={[Type.data, { color: t.inkSecondary }]}>
          {bearing}
        </Text>
      </View>
      {/* Direct-To: one tap, large target */}
      <Pressy
        accessibilityLabel={`Direct to ${icao}`}
        testID={`Direct ${icao}`}
        onPress={() => onDirectTo(entry.airport)}
        style={{
          minHeight: StripMetrics.cell + 14, // borderedProminent adds 7pt above and below the 60pt label frame
          paddingHorizontal: Space.m + DIRECT_BORDER_PADDING,
          borderRadius: 999,
          backgroundColor: t.accent,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <ArrowUpRight color={t.onAccent} />
        </View>
        <Text numberOfLines={1} style={[Type.labelBold, { color: t.onAccent }]}>
          Direct
        </Text>
      </Pressy>
    </View>
  );
}

/** borderedProminent's own horizontal inset around the label (measured: the button is 103pt wide). */
const DIRECT_BORDER_PADDING = 12;

/** ContentUnavailableView: symbol, title and description, centred. */
function Unavailable({ title, detail }: { title: string; detail: string }) {
  const t = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${title}. ${detail}`}
      style={{ padding: Space.xl, alignItems: 'center', gap: Space.s }}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Airplane color={t.inkSecondary} />
      </View>
      <Text style={[Type.systemHeadline, { color: t.ink, textAlign: 'center' }]}>{title}</Text>
      <Text style={[Type.systemSubheadline, { color: t.inkSecondary, textAlign: 'center' }]}>{detail}</Text>
    </View>
  );
}
