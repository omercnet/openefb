// FlightLogNext (efb-212/Views/Log/FlightLogStrip.swift): the NEXT band and the next waypoint row, its
// time-to in the largest type on screen beside the ident, then distance, bearing and ETA.
import { Text, View } from 'react-native';
import { scenario } from '../fixtures/scenario';
import { SectionBand, useTheme } from './Primitives';
import { Space, Type } from './tokens';

/** "9:12" -> "9 minutes 12 seconds" (m:ss under an hour). */
function spokenDuration(mss: string) {
  const [m, s] = mss.split(':').map(Number);
  const count = (v: number, unit: string) => `${v} ${unit}${v === 1 ? '' : 's'}`;
  return `${count(m, 'minute')} ${count(s, 'second')}`;
}

export function FlightLogNext() {
  const t = useTheme();
  const n = scenario.next;
  const brg = `${String(Math.round(n.brgDeg)).padStart(3, '0')}\u00B0`; // degrees true, 3 digits
  const data = `${n.distNm.toFixed(1)} NM \u00B7 ${brg} \u00B7 ETA ${n.etaLocal}`; // NM, degrees true, local time
  return (
    <View>
      <SectionBand title="Next" detail="direct" />
      <View
        accessible
        accessibilityLabel={`NEXT ${n.ident} \u00B7 in ${spokenDuration(n.timeToGo)} \u00B7 ${data}`}
        style={{ padding: Space.m, backgroundColor: t.activeCell }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: Space.m }}>
          <Text numberOfLines={1} style={[Type.nextTime, { color: t.ink }]}>
            {n.timeToGo}
          </Text>
          <Text numberOfLines={1} style={[Type.rowIdent, { color: t.ink }]}>
            {n.ident}
          </Text>
        </View>
        <Text style={[Type.data, { color: t.inkSecondary, marginTop: Space.xs }]}>{data}</Text>
      </View>
    </View>
  );
}
