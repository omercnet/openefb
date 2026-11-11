// The "End recording?" confirmation (confirmationDialog on the record button in Views/Map/RecordingOverlayView.swift). Stopping
// is asked first because it ends the GPS track, the audio and the transcript; the flight is then saved to Flights.
import { Modal, Text, View } from 'react-native';
import { useStore } from 'zustand';
import { STOP_CONFIRMATION } from '../../domain/recording/recordingNotices';
import { FormType } from '../form/formStyle';
import { Pressy, useTheme } from '../Primitives';
import type { RecordingViewStore } from '../state/recordingStore';
import { Radius, Space, StripMetrics } from '../tokens';

export function StopRecordingDialog({ store }: { store: RecordingViewStore }) {
  const t = useTheme();
  const visible = useStore(store, (s) => s.showStopConfirmation);
  const choice = (title: string, onPress: () => void, color: string, testID: string, bold?: boolean) => (
    <Pressy
      accessibilityLabel={title}
      onPress={onPress}
      testID={testID}
      style={{
        minHeight: StripMetrics.cell,
        alignItems: 'center',
        justifyContent: 'center',
        borderTopWidth: 1,
        borderTopColor: t.rule,
      }}
    >
      <Text style={[FormType.body, { color, fontWeight: bold ? '600' : '400' }]}>{title}</Text>
    </Pressy>
  );
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={() => store.getState().cancelStop()}>
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: 'rgba(0,0,0,0.4)',
          padding: Space.xl,
        }}
      >
        <View
          accessibilityViewIsModal
          testID="stop-recording-dialog"
          style={{ width: '100%', maxWidth: 360, borderRadius: Radius.l, backgroundColor: t.paper, overflow: 'hidden' }}
        >
          <View accessible accessibilityRole="alert" style={{ padding: Space.l, gap: Space.xs, alignItems: 'center' }}>
            <Text style={[FormType.headline, { color: t.primaryText, textAlign: 'center' }]}>
              {STOP_CONFIRMATION.title}
            </Text>
            <Text style={[FormType.footnote, { color: t.secondaryText, textAlign: 'center' }]}>
              {STOP_CONFIRMATION.message}
            </Text>
          </View>
          {choice(
            STOP_CONFIRMATION.confirm,
            () => void store.getState().confirmStop(),
            t.warning,
            'stop-recording-confirm',
          )}
          {choice(
            STOP_CONFIRMATION.cancel,
            () => store.getState().cancelStop(),
            t.accent,
            'stop-recording-cancel',
            true,
          )}
        </View>
      </View>
    </Modal>
  );
}
