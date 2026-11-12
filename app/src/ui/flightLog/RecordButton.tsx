// RecordButton + AudioLevelMeter (efb-212/Views/Map/RecordingOverlayView.swift), presentational only: U8 owns the
// recording overlay, the stop confirmation and the notices. At rest the mic; recording: the accent disc with a stop
// square and the level meter over the elapsed time "00:12:34"; the auto-start countdown in an amber ring.
import { Text, View } from 'react-native';
import type { RecordingStatus } from '../../domain/recording/recordingCoordinator';
import { Pressy, useTheme } from '../Primitives';
import { Radius, Space, StripMetrics, Type } from '../tokens';
import { MicFill } from './parts';

const GLYPH = 36; // points, glyph disc inside the 60pt target
const SEGMENTS = 5;

/** RecordingViewModel.formattedElapsedTime: "00:00:06". */
export function formattedElapsedTime(seconds: number): string {
  const total = Math.max(0, Math.trunc(seconds));
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(Math.floor(total / 3600))}:${two(Math.floor((total % 3600) / 60))}:${two(total % 60)}`;
}

/** Lit segments: -60...-10 dBFS onto five segments, rounded up. */
export const litSegments = (dBFS: number): number =>
  Math.ceil(((Math.min(Math.max(dBFS, -60), -10) + 60) / 50) * SEGMENTS);

const LABEL: Record<RecordingStatus['kind'], string> = {
  idle: 'Start recording',
  recording: 'Stop recording',
  countdown: 'Cancel countdown',
  paused: 'Resume recording',
  stopping: 'Stopping recording',
};

export function RecordButton({
  status,
  elapsed,
  level,
  microphoneDenied = false,
  onPress,
}: {
  status: RecordingStatus;
  /** Seconds. */
  elapsed: number;
  /** dBFS. */
  level: number;
  microphoneDenied?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const recording = status.kind === 'recording';
  const time = formattedElapsedTime(elapsed);
  let glyph;
  if (status.kind === 'countdown') {
    // Amber number in an amber ring (no filled amber block), tap to cancel.
    glyph = (
      <View
        style={{
          width: GLYPH,
          height: GLYPH,
          borderRadius: GLYPH / 2,
          borderWidth: 2,
          borderColor: t.caution,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={[Type.dataEmphasis, { color: t.caution }]}>{status.remaining}</Text>
      </View>
    );
  } else if (recording) {
    glyph = (
      <View
        style={{
          width: GLYPH,
          height: GLYPH,
          borderRadius: GLYPH / 2,
          backgroundColor: t.accent,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ width: 14, height: 14, borderRadius: Radius.xs, backgroundColor: t.onAccent }} />
      </View>
    );
  } else {
    glyph = (
      <View style={{ width: GLYPH, height: GLYPH, alignItems: 'center', justifyContent: 'center' }}>
        <MicFill color={t.ink} />
      </View>
    );
  }
  return (
    <Pressy
      accessibilityLabel={LABEL[status.kind]}
      accessibilityValue={{ text: recording ? `Recording, ${time}` : '' }}
      // Swift: idle starts, recording requests the stop, countdown cancels; paused and stopping do nothing.
      onPress={status.kind === 'paused' || status.kind === 'stopping' ? undefined : onPress}
      disabled={status.kind === 'stopping'}
      accessibilityState={{ disabled: status.kind === 'stopping' }}
      testID="record-button"
      style={{
        paddingHorizontal: Space.s,
        minWidth: StripMetrics.cell,
        minHeight: StripMetrics.cell,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Space.xs }}>
        {glyph}
        {recording && !microphoneDenied ? <AudioLevelMeter dBFS={level} /> : null}
      </View>
      {recording ? (
        <Text numberOfLines={1} style={[Type.data, { color: t.ink, marginTop: 2 }]}>
          {time}
        </Text>
      ) : null}
    </Pressy>
  );
}

/** Five 4pt bars, 8 to 16pt tall, lit in ink, unlit in rule. No animation. */
export function AudioLevelMeter({ dBFS }: { dBFS: number }) {
  const t = useTheme();
  const lit = litSegments(dBFS);
  return (
    <View
      accessibilityLabel="Audio level"
      accessibilityValue={{ text: `${lit} of ${SEGMENTS}` }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 2, height: 16 }}
    >
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <View
          key={i}
          style={{ width: 4, height: 8 + i * 2, borderRadius: 1, backgroundColor: i < lit ? t.ink : t.rule }}
        />
      ))}
    </View>
  );
}
