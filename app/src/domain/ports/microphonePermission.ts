// Port for the microphone permission the recording controls need. Replaces the direct reads of
// AVAudioApplication.shared.recordPermission in ViewModels/RecordingViewModel.swift. The audio recorder (A2) asks for the
// permission itself when it starts; this port lets the controls ask once up front and tell the pilot when audio is off.

export type MicrophoneStatus = 'undetermined' | 'granted' | 'denied';

export interface MicrophonePermission {
  /** The current status, without asking. Rejects when the platform cannot answer. */
  status(): Promise<MicrophoneStatus>;
  /** Shows the system prompt (when it can) and resolves the status afterwards (`requestRecordPermission`). */
  request(): Promise<MicrophoneStatus>;
  /** Opens the app's page in the system Settings (UIApplication.openSettingsURLString). */
  openSettings(): Promise<void>;
}

/** In-memory MicrophonePermission for tests and the screenshot fixtures. */
export class FakeMicrophonePermission implements MicrophonePermission {
  requestCalls = 0;
  openSettingsCalls = 0;
  /** When set, status() and request() reject with this. */
  failure: unknown = null;

  constructor(
    public current: MicrophoneStatus = 'granted',
    /** What asking resolves to. */
    public answer: Exclude<MicrophoneStatus, 'undetermined'> = 'granted',
  ) {}

  status(): Promise<MicrophoneStatus> {
    return this.failure === null ? Promise.resolve(this.current) : Promise.reject(this.failure);
  }

  request(): Promise<MicrophoneStatus> {
    if (this.failure !== null) return Promise.reject(this.failure);
    this.requestCalls += 1;
    this.current = this.answer;
    return Promise.resolve(this.current);
  }

  openSettings(): Promise<void> {
    this.openSettingsCalls += 1;
    return Promise.resolve();
  }
}
