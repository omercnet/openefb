// The "End recording?" confirmation (confirmationDialog on the record button in Views/Map/RecordingOverlayView.swift). Stopping
// is asked first because it ends the GPS track, the audio and the transcript; the flight is then saved to Flights.
//
// Swift shows one confirmationDialog and the system picks its form: a popover anchored on the record button on iPad (title,
// message, red End Recording, no Cancel, tap outside cancels) and an action sheet on iPhone. React Native's ActionSheetIOS
// cannot anchor reliably on the new architecture (the anchor tag is not resolved and the sheet floats mid-screen with a
// Cancel row), so iPad draws that popover itself under the measured record button. iPhone uses the system sheet; Android
// keeps an in-app dialog.
import { useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useStore } from 'zustand';
import { STOP_CONFIRMATION } from '../../domain/recording/recordingNotices';
import { FormType } from '../form/formStyle';
import { Pressy, useTheme } from '../Primitives';
import type { RecordingViewStore } from '../state/recordingStore';
import { Radius, Space, StripMetrics } from '../tokens';
import { measureRecordButton, useRecordButtonView, type WindowFrame } from './stopAnchor';

export const POPOVER_WIDTH = 285;
const POPOVER_GAP = 8;
const POPOVER_MARGIN = 8;
/** The popover's left edge sits this far left of the button's centre (SwiftUI's popover placement). */
const POPOVER_LEFT_OF_CENTRE = 113;
/** How long the popover waits for the record button to be on screen before it opens centred. */
const ANCHOR_WAIT_MS = 1000;

/** Under the button, kept inside the window. */
export function popoverPosition(button: WindowFrame | null, window: { width: number; height: number }) {
  if (!button) return { left: (window.width - POPOVER_WIDTH) / 2, top: window.height / 3 };
  const centre = button.x + button.width / 2;
  const left = Math.min(
    Math.max(centre - POPOVER_LEFT_OF_CENTRE, POPOVER_MARGIN),
    window.width - POPOVER_WIDTH - POPOVER_MARGIN,
  );
  return { left, top: button.y + button.height + POPOVER_GAP };
}

export function StopRecordingDialog({ store }: { store: RecordingViewStore }) {
  const visible = useStore(store, (s) => s.showStopConfirmation);
  if (Platform.OS === 'ios') {
    return Platform.isPad ? (
      <PadPopover store={store} visible={visible} />
    ) : (
      <PhoneSheet store={store} visible={visible} />
    );
  }
  return <InAppDialog store={store} visible={visible} />;
}

function PhoneSheet({ store, visible }: { store: RecordingViewStore; visible: boolean }) {
  const shown = useRef(false);
  useEffect(() => {
    if (!visible) shown.current = false;
    if (!visible || shown.current) return;
    shown.current = true;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: STOP_CONFIRMATION.title,
        message: STOP_CONFIRMATION.message,
        options: [STOP_CONFIRMATION.confirm, STOP_CONFIRMATION.cancel],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      (index) => (index === 0 ? void store.getState().confirmStop() : store.getState().cancelStop()),
    );
  }, [visible, store]);
  return null;
}

/** Mounted only while the question is open, so every opening starts unmeasured. */
function PadPopover({ store, visible }: { store: RecordingViewStore; visible: boolean }) {
  return visible ? <PadPopoverBody store={store} /> : null;
}

function PadPopoverBody({ store }: { store: RecordingViewStore }) {
  const t = useTheme();
  const window = useWindowDimensions();
  const button = useRecordButtonView();
  const [frame, setFrame] = useState<{ value: WindowFrame | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (button) {
      void measureRecordButton(button).then((value) => !cancelled && setFrame({ value }));
      return () => void (cancelled = true);
    }
    // The button is not on screen yet: wait for it, but never leave the pilot without the question.
    const timer = setTimeout(() => setFrame({ value: null }), ANCHOR_WAIT_MS);
    return () => clearTimeout(timer);
  }, [button, window.width, window.height]); // the button moves when the window does
  if (!frame) return null;
  const { left, top } = popoverPosition(frame.value, window);
  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => store.getState().cancelStop()}>
      {/* No dim: a popover leaves the screen as it is, and a tap outside is the cancel. The backdrop is a sibling of the
          popover (a tap on the card must not cancel) and is not a VoiceOver element: the card carries the escape gesture. */}
      <View style={{ flex: 1 }}>
        <Pressable
          accessible={false}
          onPress={() => store.getState().cancelStop()}
          style={StyleSheet.absoluteFill}
          testID="stop-recording-backdrop"
        />
        <View
          accessibilityViewIsModal
          accessibilityLabel={STOP_CONFIRMATION.title}
          onAccessibilityEscape={() => store.getState().cancelStop()}
          testID="stop-recording-popover"
          style={{
            position: 'absolute',
            left,
            top,
            width: POPOVER_WIDTH,
            padding: Space.l,
            gap: Space.s,
            borderRadius: 26,
            backgroundColor: t.paper,
            shadowColor: '#000000',
            shadowOpacity: 0.18,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 8 },
          }}
        >
          <View accessible accessibilityRole="alert" style={{ gap: Space.xs }}>
            <Text style={[FormType.headline, { color: t.primaryText }]}>{STOP_CONFIRMATION.title}</Text>
            <Text style={[FormType.footnote, { color: t.secondaryText }]}>{STOP_CONFIRMATION.message}</Text>
          </View>
          <Pressy
            accessibilityLabel={STOP_CONFIRMATION.confirm}
            onPress={() => void store.getState().confirmStop()}
            testID="stop-recording-confirm"
            style={{
              minHeight: StripMetrics.cell,
              borderRadius: 22,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: `${t.secondaryText}33`,
            }}
          >
            <Text style={[FormType.body, { color: t.warning }]}>{STOP_CONFIRMATION.confirm}</Text>
          </Pressy>
        </View>
      </View>
    </Modal>
  );
}

function InAppDialog({ store, visible }: { store: RecordingViewStore; visible: boolean }) {
  const t = useTheme();
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
          accessibilityLabel={STOP_CONFIRMATION.title}
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
