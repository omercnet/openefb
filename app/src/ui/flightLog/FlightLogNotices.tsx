// FlightLogNotices (efb-212/Views/Log/FlightLogRows.swift): full-width warning and caution rows in priority order above
// NEXT; nothing when all is well. The banners it stacks are other tickets' views (GPSFailureNotice,
// AirspaceCheckUnavailableBanner, IsraelAlertsSuspendedBanner: U4); they are drawn here from the same text until those
// ports land. Not stacked yet: IsraelAlertBanner, CurrencyWarningBanner, DataAgeBadge, OverlayStalenessBadges,
// IsraelChartHintBanner (U4). RecordingNotices (U8) come last, from the recording store the shell provides.
import { Text, View } from 'react-native';
import { gpsFailureMessage, gpsFailureOffersSettings, gpsFailureTitle } from '../../domain/location/gpsStatus';
import { WarningTriangle } from '../Icons';
import { RecordingNotices } from '../recording/RecordingNotices';
import { useRecordingStore } from '../recording/RecordingStoreContext';
import { Pressy, useTheme } from '../Primitives';
import { MapControlMetrics, Space, Type } from '../tokens';
import { useFlightLog } from './hooks';
import { NoticeRow, Slashed } from './parts';

export function FlightLogNotices() {
  const t = useTheme();
  const { data, gpsFailure, stale } = useFlightLog();
  const recordingStore = useRecordingStore();
  const card = {
    padding: Space.m,
    backgroundColor: t.paperSecondary,
    borderRadius: MapControlMetrics.cornerRadius,
  };
  const heading = [Type.systemSubheadline, { fontWeight: '600' as const, color: t.caution, flexShrink: 1 }];
  const caption = [Type.caption, { color: t.secondaryText }];
  const notices = [];

  // Why there is no position, with Open Settings when the pilot can fix it.
  if (gpsFailure && stale) {
    notices.push(
      <View
        key="gps"
        testID="gps-failure-notice"
        style={[card, { flexDirection: 'row', alignItems: 'center', gap: Space.m }]}
      >
        <View style={{ flex: 1, gap: Space.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Space.xs }}>
            <Slashed glyph="location" color={t.caution} />
            <Text style={heading}>{gpsFailureTitle(gpsFailure)}</Text>
          </View>
          <Text style={caption}>{gpsFailureMessage(gpsFailure)}</Text>
        </View>
        {gpsFailureOffersSettings(gpsFailure) ? (
          <Pressy
            accessibilityLabel="Open Settings"
            onPress={data.actions.openSettings}
            testID="gps-open-settings"
            style={{
              minWidth: MapControlMetrics.size,
              minHeight: MapControlMetrics.size,
              paddingHorizontal: Space.m,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: MapControlMetrics.cornerRadius,
              backgroundColor: t.fill,
            }}
          >
            <Text style={[Type.systemSubheadline, { color: t.accent }]}>Open Settings</Text>
          </Pressy>
        ) : null}
      </View>,
    );
  }
  // The airspace proximity check cannot run: say so instead of showing nothing (efb-8lm).
  if (data.airspaceCheckUnavailable) {
    notices.push(
      <View key="airspace" accessible testID="airspace-check-unavailable" style={[card, { gap: Space.xs }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Space.xs }}>
          <WarningTriangle color={t.caution} bang={t.paperSecondary} />
          <Text style={heading}>Airspace check unavailable</Text>
        </View>
        <Text style={caption}>Airspace and TFR alerts are not running. Check airspace on the chart.</Text>
      </View>,
    );
  }
  // Israel alerts cannot be evaluated without a fresh fix: say so instead of showing the last ones as current.
  if (data.israelAlertsSuspended) {
    notices.push(
      <View
        key="alerts"
        accessible
        accessibilityLabel="Caution: alerts off, no GPS position. Airspace, border and route closure alerts resume with a fix."
        testID="israel-alerts-suspended"
        style={[card, { flexDirection: 'row', alignItems: 'center', gap: Space.s, backgroundColor: t.cautionFill }]}
      >
        <WarningTriangle color="black" bang={t.cautionFill} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[Type.systemHeadline, { fontWeight: '700', color: 'black' }]}>ALERTS OFF: NO GPS POSITION</Text>
          <Text style={[Type.systemSubheadline, { color: 'black' }]}>
            Airspace, border and route closure alerts resume with a fix.
          </Text>
        </View>
      </View>,
    );
  }
  if (data.isOffline) {
    notices.push(
      <NoticeRow key="offline" tint={t.caution} accessible testID="offline-notice">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Space.xs }}>
          <Slashed glyph="wifi" color={t.caution} />
          <Text style={[Type.data, { color: t.caution }]}>Offline, using cached data</Text>
        </View>
      </NoticeRow>,
    );
  }
  if (recordingStore) notices.push(<RecordingNotices key="recording-notices" store={recordingStore} />);
  // Recording database failed: the rest of the app works, but say so (no silent missing button).
  if (!data.recording && data.recordingUnavailable) {
    notices.push(
      <NoticeRow key="recording" tint={t.caution} accessible testID="recording-unavailable">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Space.xs }}>
          <Slashed glyph="mic" color={t.caution} />
          <Text style={heading}>Recording unavailable</Text>
        </View>
      </NoticeRow>,
    );
  }
  return notices.length ? <View style={{ gap: Space.xs }}>{notices}</View> : null;
}
