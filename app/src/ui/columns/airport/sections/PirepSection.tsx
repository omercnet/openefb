// Port of efb-212/Views/Map/PirepSection.swift: pilot reports within 50 NM from the last 2 hours, newest first. Urgent
// PIREPs (UUA) are highlighted red; the raw report text expands per row. Decisions live in ./pirepLogic.ts.
//
// Props (the Swift view's `@State state: LoadState` and its `load()` task, lifted so the airport column store feeds it):
// - `airport`   the selected airport (ICAO and position: the location line measures distance and bearing from it).
// - `loading`   a fetch is in flight. A loaded list stays on screen while it runs (Swift keeps `.loaded` on refresh);
//               the spinner shows only before the first result.
// - `error`     the last fetch's message (`error.localizedDescription`), or null. Shown instead of the list with Retry.
// - `pireps`    the last loaded reports (PirepService.fetchPireps with PIREP_RADIUS_NM and PIREP_MAX_AGE_SECONDS), or
//               null before the first load. An empty array is the "No PIREPs ..." state.
// - `now`       epoch ms the age badges are judged at (the store's ticking clock; Swift's badge read `Date()`).
// - `onRetry`   `load()`: the header's refresh button and the failure's Retry button both call it.
// - `onLoad`    optional `.task(id: airport.icao)`: called on mount and whenever the ICAO changes, so the owner fetches.
// Which rows have their raw report expanded stays local view state (Swift `@State expandedIDs`).
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { Pirep } from '../../../../services/pirep';
import { DataAgeBadge } from '../../../components/Components';
import { withAlpha } from '../../../flights/alpha';
import { ArrowClockwise, Chevron, WarningTriangle } from '../../../Icons';
import { Pressy, useTheme } from '../../../Primitives';
import { Radius, Space, Type, lineHeight } from '../../../tokens';
import { FailureBlock, LoadingRow, SystemHeader } from '../sections';
import {
  PIREP_REFRESH_LABEL,
  PIREP_SECTION_TITLE,
  pirepBody,
  pirepRow,
  rawReportValue,
  type PirepRow,
  type SectionAirport,
} from './pirepLogic';

export interface PirepSectionProps {
  airport: SectionAirport;
  loading: boolean;
  error: string | null;
  pireps: readonly Pirep[] | null;
  now: number;
  onRetry: () => void;
  onLoad?: (airport: SectionAirport) => void;
}

/** 44 pt minimum touch target (Swift `.frame(minWidth: 44, minHeight: 44)`). */
const TARGET = 44;
/** `.footnote.monospaced()`: 13 pt in the bundled mono face. */
const footnoteMono = { ...Type.data, fontSize: 13, lineHeight: lineHeight(13, 1.3) };

export function PirepSection({ airport, loading, error, pireps, now, onRetry, onLoad }: PirepSectionProps) {
  const t = useTheme();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const icao = airport.icao;

  // `.task(id: airport.icao) { await load() }`
  useEffect(() => {
    onLoad?.(airport);
    // Keyed by the ICAO only, like the Swift task id: a new airport object for the same ICAO does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [icao]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const body = pirepBody({ loading, error, pireps });
  let content;
  switch (body.kind) {
    case 'loading':
      content = <LoadingRow testID="pirep-loading" label="Loading PIREPs" />;
      break;
    case 'error':
      content = <FailureBlock text={body.text} onRetry={onRetry} testID="pirep-error" />;
      break;
    case 'empty':
      content = (
        <Text testID="pirep-empty" style={[Type.systemSubheadline, { color: t.secondaryText }]}>
          {body.text}
        </Text>
      );
      break;
    case 'list':
      content = body.pireps.map((p) => {
        const row = pirepRow(airport, p, now);
        return <PirepRowView key={row.id} row={row} expanded={expanded.has(row.id)} onToggle={() => toggle(row.id)} />;
      });
      break;
  }

  return (
    <View testID="pirep-section" style={{ gap: Space.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <SystemHeader title={PIREP_SECTION_TITLE} />
        <View style={{ flex: 1 }} />
        <Pressy
          accessibilityLabel={PIREP_REFRESH_LABEL}
          accessibilityState={{ busy: loading }}
          testID="pirep-refresh"
          onPress={onRetry}
          style={{ minWidth: TARGET, minHeight: TARGET, alignItems: 'center', justifyContent: 'center' }}
        >
          <ArrowClockwise color={t.accentText} size={17} />
        </Pressy>
      </View>
      {content}
    </View>
  );
}

function PirepRowView({ row, expanded, onToggle }: { row: PirepRow; expanded: boolean; onToggle: () => void }) {
  const t = useTheme();
  const urgent = row.tone === 'urgent';
  return (
    <View
      testID="pirep-row"
      style={{
        gap: Space.xs,
        padding: Space.s,
        borderRadius: Radius.s,
        backgroundColor: urgent ? withAlpha(t.warning, 0.15) : t.fill,
        borderWidth: urgent ? 1 : 0,
        borderColor: urgent ? t.warning : 'transparent',
      }}
    >
      <View
        accessible
        accessibilityLabel={row.headerAccessibilityLabel}
        testID="pirep-row-header"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
      >
        {row.urgent ? (
          <View testID="pirep-urgent" style={{ flexDirection: 'row', alignItems: 'center', gap: Space.xs }}>
            <WarningTriangle color={t.warning} bang={t.night ? '#000000' : '#FFFFFF'} />
            <Text style={[Type.caption, { color: t.warning, fontWeight: '700' }]}>URGENT</Text>
          </View>
        ) : null}
        <Text style={[Type.systemSubheadline, { color: t.primaryText, fontWeight: '600' }]}>{row.altitudeText}</Text>
        {row.aircraftType !== null ? (
          <Text numberOfLines={1} style={[Type.systemSubheadline, { color: t.secondaryText, flexShrink: 1 }]}>
            {row.aircraftType}
          </Text>
        ) : null}
        <View style={{ flex: 1 }} />
        <DataAgeBadge level={row.freshness.level} text={row.freshness.text} productName="PIREP" />
      </View>

      <Text testID="pirep-location" style={[Type.caption, { color: t.secondaryText }]}>
        {row.locationText}
      </Text>

      {row.summaryLines.map((line) => (
        <Text key={line} testID="pirep-summary" style={[Type.systemSubheadline, { color: t.primaryText }]}>
          {line}
        </Text>
      ))}

      <Pressy
        accessibilityLabel="Raw report"
        accessibilityValue={{ text: rawReportValue(expanded) }}
        accessibilityState={{ expanded }}
        testID="pirep-raw-toggle"
        onPress={onToggle}
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Text style={[Type.caption, { color: t.secondaryText }]}>Raw report</Text>
        <View style={expanded ? { transform: [{ rotate: '180deg' }] } : undefined}>
          <Chevron dir="down" color={t.secondaryText} />
        </View>
      </Pressy>

      {expanded ? (
        <Text selectable testID="pirep-raw-text" style={[footnoteMono, { color: t.primaryText }]}>
          {row.rawText}
        </Text>
      ) : null}
    </View>
  );
}
