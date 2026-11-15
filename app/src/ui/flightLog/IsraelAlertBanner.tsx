// IsraelAlertBanner (Views/Map/IsraelAlertBanner.swift, IL-ALERTS): the one banner area for Israel in-flight alerts. The
// highest priority alert is shown in full on top (red = warning, amber = caution, nothing else); the rest are one line each,
// at most two, then "+N more". Alerts never stack into a pile and nothing animates.
//
// PROPS
// - `alerts`: the Israel alerts, highest priority first (`IsraelAlertsService.alerts`, `AlertsSnapshot.israelAlerts`).
//   Empty renders nothing. The caller shows this instead of the "alerts off" notice while alerts are suspended
//   (FlightLogNotices stacks it; Track A mounts it, I1d).
import { StyleSheet, Text, View } from 'react-native';
import type { IsraelAlert } from '../../domain/israel/alertEvaluator';
import { OctagonWarning, WarningTriangle } from '../Icons';
import { useTheme } from '../Primitives';
import { MapControlMetrics, Radius, Space, Type, type Theme } from '../tokens';

const MAX_SECONDARY = 2;

const background = (t: Theme, severity: IsraelAlert['severity']) =>
  severity === 'warning' ? t.warning : t.cautionFill;
/** Red warning (white text, 5.4:1 on the day red) or amber caution (black text, 9:1). */
const foreground = (severity: IsraelAlert['severity']) => (severity === 'warning' ? 'white' : 'black');

function Row({ alert, prominent, topSeverity }: { alert: IsraelAlert; prominent: boolean; topSeverity: string }) {
  const t = useTheme();
  const color = foreground(alert.severity);
  const Icon = alert.severity === 'warning' ? OctagonWarning : WarningTriangle;
  // A caution under a red top alert keeps its own amber, so red never reads as "everything is a warning".
  const fill = !prominent && alert.severity !== topSeverity ? background(t, alert.severity) : undefined;
  return (
    <View
      accessible
      testID={`israel-alert-${alert.id}`}
      accessibilityLabel={`${alert.severity === 'warning' ? 'Warning' : 'Caution'}: ${alert.title}. ${alert.detail ?? ''}`}
      style={[
        styles.row,
        { paddingHorizontal: prominent ? 0 : Space.s, paddingVertical: prominent ? 0 : Space.xs },
        fill ? { backgroundColor: fill, borderRadius: Radius.s } : null,
      ]}
    >
      <View style={styles.titleLine}>
        <Icon color={color} bang={background(t, alert.severity)} size={prominent ? 20 : 16} />
        <Text
          numberOfLines={prominent ? 3 : 1}
          style={[
            prominent ? Type.systemHeadline : Type.systemSubheadline,
            { color, fontWeight: prominent ? '700' : '600', flexShrink: 1 },
          ]}
        >
          {alert.title}
        </Text>
      </View>
      {prominent && alert.detail ? (
        <Text numberOfLines={2} style={[Type.systemSubheadline, { color }]}>
          {alert.detail}
        </Text>
      ) : null}
    </View>
  );
}

export function IsraelAlertBanner({ alerts }: { alerts: readonly IsraelAlert[] }) {
  const t = useTheme();
  const top = alerts[0];
  if (!top) return null;
  const hidden = alerts.length - 1 - MAX_SECONDARY;
  return (
    <View
      testID="israel-alert-banner"
      style={[
        styles.banner,
        { backgroundColor: background(t, top.severity), borderRadius: MapControlMetrics.cornerRadius },
      ]}
    >
      <Row alert={top} prominent topSeverity={top.severity} />
      {alerts.slice(1, 1 + MAX_SECONDARY).map((alert) => (
        <Row key={alert.id} alert={alert} prominent={false} topSeverity={top.severity} />
      ))}
      {hidden > 0 ? (
        <Text style={[Type.systemFootnoteSemibold, { color: foreground(top.severity) }]}>{`+${hidden} more`}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { padding: Space.m, gap: Space.xs, maxWidth: 520, alignSelf: 'stretch' },
  row: { gap: 2, alignSelf: 'stretch' },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: Space.s },
});
