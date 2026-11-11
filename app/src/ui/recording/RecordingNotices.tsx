// RecordingNotices (efb-212/Views/Map/RecordingOverlayView.swift): recording problems as full-width strip rows, shown only when
// one applies: the microphone is off (the GPS track still records), a failed start or a failure in the middle of a recording,
// and a recording that was not saved. The record button is U3's; the state is the view model's (ui/state/recordingStore).
import { useEffect, type ReactNode } from 'react';
import { AppState, Text, View } from 'react-native';
import { useStore } from 'zustand';
import type { AppError } from '../../domain/errors';
import {
  DISCARDED_NOTICE,
  MICROPHONE_NOTICE,
  problemSeverity,
  recordingErrorNotice,
} from '../../domain/recording/recordingNotices';
import { FormType } from '../form/formStyle';
import { WarningTriangle } from '../Icons';
import { Pressy, useTheme } from '../Primitives';
import type { RecordingViewStore } from '../state/recordingStore';
import { refreshMicrophoneOnForeground } from '../state/refreshMicrophoneOnForeground';
import { Space, StripMetrics, Type } from '../tokens';
import { MicSlashFill, TrashSlashFill } from './icons';

/** noticeRow: the active-cell background with a 4 pt rule in the notice's colour at the leading edge (never a filled amber block). */
function NoticeRow({ tint, testID, children }: { tint: string; testID: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View testID={testID} style={{ padding: Space.m, alignSelf: 'stretch', backgroundColor: t.activeCell }}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: tint }}
      />
      {children}
    </View>
  );
}

/** A bordered large button: a 60 pt target (an in-flight control). */
function NoticeButton({
  title,
  label,
  onPress,
  testID,
}: {
  title: string;
  label?: string;
  onPress: () => void;
  testID: string;
}) {
  const t = useTheme();
  return (
    <Pressy
      accessibilityLabel={label ?? title}
      onPress={onPress}
      testID={testID}
      style={{
        minWidth: StripMetrics.cell,
        minHeight: StripMetrics.cell,
        paddingHorizontal: Space.l,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: StripMetrics.cell / 2,
        backgroundColor: t.infoFill,
      }}
    >
      <Text style={[FormType.body, { color: t.accent }]}>{title}</Text>
    </Pressy>
  );
}

function Heading({ icon, title, tint }: { icon: ReactNode; title: string; tint: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Space.xs }}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {icon}
      </View>
      <Text
        accessibilityRole="header"
        style={[Type.systemSubheadline, { fontWeight: '600', color: tint, flexShrink: 1 }]}
      >
        {title}
      </Text>
    </View>
  );
}

/** The microphone is off while recording: the GPS track still records. */
function MicrophoneNotice({ store }: { store: RecordingViewStore }) {
  const t = useTheme();
  return (
    <NoticeRow tint={t.caution} testID="mic-denied-notice">
      <View style={{ gap: Space.xs }}>
        <Heading icon={<MicSlashFill color={t.caution} />} title={MICROPHONE_NOTICE.title} tint={t.caution} />
        <Text style={[Type.caption, { color: t.inkSecondary }]}>{MICROPHONE_NOTICE.text}</Text>
        <View style={{ alignSelf: 'flex-start' }}>
          <NoticeButton
            title={MICROPHONE_NOTICE.action}
            onPress={() => void store.getState().openMicrophoneSettings()}
            testID="mic-open-settings"
          />
        </View>
      </View>
    </NoticeRow>
  );
}

/** A failed start or a failure in the middle of a recording: amber while recording continues, red once it has stopped. */
function ProblemNotice({ store, error }: { store: RecordingViewStore; error: AppError }) {
  const t = useTheme();
  const severity = problemSeverity(useStore(store, (s) => s.status));
  const tint = severity === 'caution' ? t.caution : t.warning;
  const notice = recordingErrorNotice(error, severity);
  return (
    <NoticeRow tint={tint} testID={`recording-error-notice-${severity}`}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: Space.s }}>
        <View style={{ flex: 1, gap: Space.xs }}>
          <Heading icon={<WarningTriangle color={tint} bang={t.activeCell} />} title={notice.title} tint={tint} />
          <Text style={[Type.caption, { color: t.inkSecondary }]}>{notice.text}</Text>
        </View>
        <NoticeButton
          title="Dismiss"
          label="Dismiss recording problem"
          onPress={() => store.getState().dismissError()}
          testID="recording-error-dismiss"
        />
      </View>
    </NoticeRow>
  );
}

/** The recording ended with no GPS track points, so nothing was saved. */
function DiscardedNotice({ store }: { store: RecordingViewStore }) {
  const t = useTheme();
  return (
    <NoticeRow tint={t.caution} testID="recording-discarded-notice">
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: Space.s }}>
        <View style={{ flex: 1, gap: Space.xs }}>
          <Heading icon={<TrashSlashFill color={t.caution} />} title={DISCARDED_NOTICE.title} tint={t.caution} />
          <Text style={[Type.caption, { color: t.inkSecondary }]}>{DISCARDED_NOTICE.text}</Text>
        </View>
        <NoticeButton
          title="Dismiss"
          label="Dismiss recording not saved notice"
          onPress={() => store.getState().dismissDiscardedNotice()}
          testID="recording-discarded-dismiss"
        />
      </View>
    </NoticeRow>
  );
}

export function RecordingNotices({ store }: { store: RecordingViewStore }) {
  // Back from the system Settings the permission is read again, so the microphone notice goes when it was turned on.
  useEffect(() => refreshMicrophoneOnForeground(store, AppState), [store]);
  const microphoneDenied = useStore(store, (s) => s.microphoneDenied);
  const lastError = useStore(store, (s) => s.lastError);
  const showDiscardedNotice = useStore(store, (s) => s.showDiscardedNotice);
  return (
    <>
      {microphoneDenied ? <MicrophoneNotice store={store} /> : null}
      {lastError ? <ProblemNotice store={store} error={lastError} /> : null}
      {showDiscardedNotice ? <DiscardedNotice store={store} /> : null}
    </>
  );
}
