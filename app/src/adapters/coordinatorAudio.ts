// The A2 AudioRecorder port in the shape RecordingCoordinator takes (AudioRecorderLike, domain/recording/collaborators).
// The two were written apart: the port has start/stop/audioLevel() and typed gap reasons, the coordinator wants
// startRecording/stopRecording, an audioLevel property and the gap reason as the text it prints after "[INTERRUPTION: ".
import type { AudioRecorder, InterruptionGapReason } from '../domain/ports/audioRecorder';
import type { AudioRecorderLike } from '../domain/recording/collaborators';

/**
 * Swift interpolates the InterruptionGapReason enum into "[INTERRUPTION: \(reason)]": `phoneCall`, or
 * `other("detail")` for the case with a payload. Same text as interruptionGapText in domain/ports/audioRecorder.
 */
export function describeGapReason(reason: InterruptionGapReason): string {
  return reason.kind === 'other' ? `other(${JSON.stringify(reason.detail)})` : reason.kind;
}

export function asCoordinatorAudio(recorder: AudioRecorder): AudioRecorderLike {
  return {
    startRecording: (flightID, profile, outputURL) => recorder.start(flightID, profile, outputURL),
    stopRecording: () => recorder.stop(),
    get audioLevel() {
      return recorder.audioLevel();
    },
    setOnInterruptionGap: (handler) => recorder.setOnInterruptionGap((reason) => handler(describeGapReason(reason))),
    setOnRecordingError: (handler) => recorder.setOnRecordingError(handler),
  };
}
