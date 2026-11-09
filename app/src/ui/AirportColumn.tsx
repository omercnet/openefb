// AirportColumnView (efb-212/Views/Log/AirportColumnView.swift, Map/NotamSection.swift, Map/AirportChartsSection.swift):
// header with the Log back button, Direct, info chips, weather with its age, frequencies, runways, the NOTAM key
// hint and the FAA chart rows. Text set in SF by the SwiftUI views uses the platform system font here.
import type { ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { scenario } from '../fixtures/scenario';
import { Airplane, ArrowClockwise, ArrowUp, ArrowUpRight, Chevron, FuelPump, Key, WarningTriangle } from './Icons';
import { ColumnRule, Pressy, SectionLabel, useTheme } from './Primitives';
import { Space, StripMetrics, Type } from './tokens';

const a = scenario.airport;
const LABEL_COLUMN = 80; // minWidth of the label column, points
/** AirportColumnView.frequencySpokenName: so VoiceOver does not spell "TWR" / "CD". */
const SPOKEN: Record<string, string> = {
  CTAF: 'C TAF', TWR: 'Tower', GND: 'Ground', CD: 'Clearance delivery', APP: 'Approach', DEP: 'Departure',
  UNICOM: 'Unicom', MULTICOM: 'Multicom', CTR: 'Center', FSS: 'Flight service',
};

export function AirportHeader() {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: Space.s,
        paddingHorizontal: Space.s,
        minHeight: StripMetrics.cell,
        backgroundColor: t.paperSecondary,
      }}
    >
      <Pressy
        accessibilityLabel="Back to flight log"
        style={{ minWidth: StripMetrics.cell, minHeight: StripMetrics.cell, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 11 }}
      >
        <Chevron dir="left" color={t.ink} />
        <Text style={[Type.label, { color: t.ink }]}>Log</Text>
      </Pressy>
      <View accessible accessibilityRole="header" accessibilityLabel={`${a.ident}, flight category ${a.flightCategory}, ${a.name}`} style={{ flex: 1, paddingVertical: Space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: Space.s }}>
          <Text numberOfLines={1} style={[Type.title, { color: t.airspace }]}>
            {a.ident}
          </Text>
          {/* Dot out of flow so the container's baseline is the "MVFR" text baseline (SwiftUI firstTextBaseline);
              as a first child the dot's bottom edge became the baseline on iOS. 12pt dot + Space.xs. */}
          <View style={{ paddingLeft: 12 + Space.xs }}>
            <Text style={[Type.systemHeadline, { color: t.primaryText }]}>{a.flightCategory}</Text>
            <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, justifyContent: 'center' }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: t.categoryMVFR }} />
            </View>
          </View>
        </View>
        <Text numberOfLines={2} style={[Type.body, { color: t.inkSecondary }]}>
          {a.name}
        </Text>
      </View>
      <ColumnRule style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }} />
    </View>
  );
}

export function AirportColumn() {
  const t = useTheme();
  const rule = <ColumnRule />;
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: Space.l, gap: Space.l }} showsVerticalScrollIndicator={false}>
      <Pressy
        accessibilityLabel={`Direct to ${a.ident}`}
        style={{
          minHeight: StripMetrics.cell + 14, // borderedProminent adds 7pt above and below the 60pt label frame (measured 74pt)
          borderRadius: 999,
          backgroundColor: t.accent,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 9,
        }}
      >
        <ArrowUpRight color={t.onAccent} />
        <Text style={[Type.labelBold, { color: t.onAccent }]}>Direct {a.ident}</Text>
      </Pressy>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Space.s }}>
        <Chip icon={<ArrowUp color={t.ink} size={13} />} text={`${a.elevationFt}' MSL`} />
        <Chip icon={<Airplane color={t.ink} />} text="Airport" />
        <Chip icon={<ArrowClockwise color={t.ink} size={12} />} text={`TPA ${a.tpaFt}'`} />
        <Chip icon={<FuelPump color={t.ink} />} text={a.fuelTypes.join(', ')} />
      </ScrollView>
      <Weather />
      {rule}
      <View style={{ gap: Space.s }}>
        <SectionLabel title="Frequencies" />
        {a.frequencies.map(([type, mhz], i) => (
          <Row key={`${type}${i}`} label={type} spoken={SPOKEN[type] ?? type} value={`${mhz} megahertz`}>
            <Text style={[Type.dataEmphasis, { color: t.ink }]}>{mhz}</Text>
          </Row>
        ))}
      </View>
      {rule}
      <View style={{ gap: Space.s }}>
        <SectionLabel title="Runways" />
        {a.runways.map((r) => (
          <View
            key={r.ident}
            accessible
            accessibilityLabel={`Runway ${r.ident}`}
            accessibilityValue={{ text: `${r.lengthFt} by ${r.widthFt} feet, ${r.surface}` }}
            style={{ flexDirection: 'row', alignItems: 'baseline', gap: Space.m }}
          >
            <Text style={[Type.dataEmphasis, { color: t.ink, minWidth: LABEL_COLUMN }]}>{r.ident}</Text>
            <Text style={[Type.data, { color: t.ink }]}>{`${r.lengthFt.toLocaleString('en-US')}' x ${r.widthFt}'`}</Text>
            <Text style={[Type.body, { color: t.inkSecondary }]}>{r.surface}</Text>
          </View>
        ))}
      </View>
      {rule}
      <View style={{ gap: Space.s }}>
        <SystemHeader title="NOTAMS" />
        <View accessible style={{ flexDirection: 'row', gap: 6 }}>
          <View style={{ width: 16, alignItems: 'center', paddingTop: 1 }}>
            <Key color={t.secondaryText} />
          </View>
          <Text style={[Type.systemSubheadline, { color: t.secondaryText, flex: 1, lineHeight: 20 }]}>
            NOTAMs need a free FAA API key. Add it in Settings {'\u203A'} NOTAM API.
          </Text>
        </View>
      </View>
      {rule}
      <View style={{ gap: Space.s }}>
        <SystemHeader title="FAA CHARTS" />
        <Text style={[Type.caption, { color: t.secondaryText }]}>
          Cycle {a.chartsCycle} {'\u00B7'} Valid to {a.chartsValidTo}
        </Text>
        <ChartGroup title="Airport Diagram" charts={['AIRPORT DIAGRAM']} />
        <ChartGroup title="Approaches" charts={a.approaches} />
      </View>
    </ScrollView>
  );
}

function Chip({ icon, text }: { icon: ReactNode; text: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: Space.xs,
        paddingHorizontal: Space.m,
        paddingVertical: Space.s,
        borderRadius: 999,
        backgroundColor: t.paperSecondary,
      }}
    >
      {icon}
      <Text style={[Type.data, { color: t.ink }]}>{text}</Text>
    </View>
  );
}

/** Label column beside a value, first-baseline aligned. */
function Row({ label, spoken, value, children }: { label: string; spoken: string; value: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View accessible accessibilityLabel={spoken} accessibilityValue={{ text: value }} style={{ flexDirection: 'row', alignItems: 'baseline', gap: Space.m }}>
      <Text style={[Type.label, { color: t.inkSecondary, minWidth: LABEL_COLUMN }]}>{label}</Text>
      {children}
    </View>
  );
}

function Weather() {
  const t = useTheme();
  const w = a.wx;
  const fields: [string, string, string][] = [
    ['Wind', 'Wind', w.wind],
    ['Vis', 'Visibility', w.vis],
    ['Ceiling', 'Ceiling', w.ceiling],
    ['Temp', 'Temperature', w.temp],
    ['Dewpt', 'Dew point', w.dewpt],
    ['Altim', 'Altimeter', w.altim],
  ];
  return (
    <View style={{ gap: Space.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Space.s }}>
        <SectionLabel title="Weather" />
        <View
          accessible
          accessibilityLabel="METAR age"
          accessibilityValue={{ text: `${a.weatherAgeMin} min` }}
          style={{ paddingHorizontal: Space.s, paddingVertical: Space.xs, borderRadius: 999, backgroundColor: t.night ? 'rgba(235,235,245,0.12)' : 'rgba(60,60,67,0.12)' }}
        >
          <Text style={[Type.systemFootnoteSemibold, { color: t.secondaryText }]}>{a.weatherAgeMin} min</Text>
        </View>
        <View style={{ flex: 1 }} />
        <Pressy accessibilityLabel="Refresh weather" style={{ width: StripMetrics.cell, height: StripMetrics.cell, alignItems: 'center', justifyContent: 'center' }}>
          <ArrowClockwise color={t.inkSecondary} size={16} />
        </Pressy>
      </View>
      <View style={{ gap: Space.s }}>
        {fields.map(([label, spoken, value]) => (
          <Row key={label} label={label} spoken={spoken} value={value}>
            <Text style={[Type.data, { color: t.ink }]}>{value}</Text>
          </Row>
        ))}
        <Pressy
          accessibilityLabel="Raw METAR"
          accessibilityValue={{ text: 'Collapsed' }}
          style={{ minHeight: StripMetrics.cell, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Text style={[Type.label, { color: t.inkSecondary }]}>Raw METAR</Text>
          <Chevron dir="down" color={t.inkSecondary} />
        </Pressy>
      </View>
      {/* 15pt row: the caption-size SF triangle's frame (reference: the TAF row is 19.2pt with its 4pt top padding). */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingTop: Space.xs, minHeight: Space.xs + 15 }}>
        <WarningTriangle color={t.caution} bang={t.night ? '#000000' : '#FFFFFF'} />
        <Text style={[Type.caption, { color: t.caution }]}>TAF not loaded</Text>
      </View>
    </View>
  );
}

/** SectionHeader (DesignTokens.swift): Archivo SemiBold 12 in the system secondary color. */
function SystemHeader({ title }: { title: string }) {
  const t = useTheme();
  return (
    <Text accessibilityRole="header" style={[Type.sectionHeader, { color: t.secondaryText }]}>
      {title}
    </Text>
  );
}

function ChartGroup({ title, charts }: { title: string; charts: readonly string[] }) {
  const t = useTheme();
  return (
    <View style={{ gap: Space.xs }}>
      <Text style={[Type.label, { color: t.secondaryText }]}>{title}</Text>
      {charts.map((name) => (
        <Pressy
          key={name}
          accessibilityLabel={name}
          style={{ minHeight: 44, marginVertical: Space.xs, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Text style={[Type.systemSubheadline, { color: t.primaryText }]}>{name}</Text>
          <Chevron dir="right" color={t.secondaryText} />
        </Pressy>
      ))}
    </View>
  );
}
