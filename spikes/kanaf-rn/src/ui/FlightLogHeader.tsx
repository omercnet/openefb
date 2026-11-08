// FlightLogHeader + RecordButton (efb-212/Views/Log/FlightLogRows.swift, Views/Map/RecordingOverlayView.swift):
// LOG, route title, SEARCH, then the record control (stop disc, level meter, elapsed time). 60pt high.
import { Text, View } from 'react-native';
import { scenario } from '../fixtures/scenario';
import { ListBullet, Magnifier } from './Icons';
import { CellButton, Pressy, useTheme } from './Primitives';
import { Radius, Space, StripMetrics, Type } from './tokens';

export function FlightLogHeader() {
  const t = useTheme();
  const route = `DIRECT ${scenario.next.ident}`;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: StripMetrics.cell, backgroundColor: t.paperSecondary }}>
      <CellButton title="Log" label="Flight log" icon={<ListBullet color={t.ink} />} />
      <Text
        numberOfLines={1}
        accessibilityLabel={`Route ${route}`}
        style={[Type.dataEmphasis, { color: t.ink, flex: 1, paddingHorizontal: Space.s }]}
      >
        {route}
      </Text>
      <CellButton title="Search" label="Search airports" icon={<Magnifier color={t.ink} />} />
      <RecordButton />
    </View>
  );
}

/** Recording state: accent disc with a stop square, the (silent) level meter, the elapsed time below. */
function RecordButton() {
  const t = useTheme();
  const elapsed = scenario.recording.elapsed;
  return (
    <Pressy
      accessibilityLabel="Stop recording"
      accessibilityValue={{ text: `Recording, ${elapsed}` }}
      style={{ paddingHorizontal: Space.s, minWidth: StripMetrics.cell, minHeight: StripMetrics.cell, alignItems: 'center', justifyContent: 'center' }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Space.xs }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 14, height: 14, borderRadius: Radius.xs, backgroundColor: t.onAccent }} />
        </View>
        <LevelMeter lit={0} />
      </View>
      <Text numberOfLines={1} style={[Type.data, { color: t.ink, marginTop: 2 }]}>
        {elapsed}
      </Text>
    </Pressy>
  );
}

/** AudioLevelMeter: five 4pt bars, 8 to 16pt tall, lit in ink, unlit in rule. */
function LevelMeter({ lit }: { lit: number }) {
  const t = useTheme();
  return (
    <View accessibilityLabel="Audio level" accessibilityValue={{ text: `${lit} of 5` }} style={{ flexDirection: 'row', alignItems: 'center', gap: 2, height: 16 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={{ width: 4, height: 8 + i * 2, borderRadius: 1, backgroundColor: i < lit ? t.ink : t.rule }} />
      ))}
    </View>
  );
}
