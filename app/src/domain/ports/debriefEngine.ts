import type { FlightDebrief } from '../debrief/types';

// The AI debrief as the screens see it (efb-212/Services/Debrief/DebriefEngine.swift: an @Observable around Apple's on-device
// language model). The model call, its session and the persisting of the result are the adapter's (A6); the screens read this state
// and call these methods. On Android there is no engine: the AI debrief is not shown there (owner decision Q8).

/** DebriefEngine.AvailabilityStatus. */
export type DebriefAvailability =
  | { kind: 'unknown' }
  | { kind: 'available' }
  /** `reason` is the message for the pilot (DebriefEngine.AvailabilityStatus.reasonMessage). */
  | { kind: 'unavailable'; reason: string };

/** PhaseObservation.PartiallyGenerated: what the model has written of one phase so far. */
export interface PartialPhaseObservation {
  phase?: string;
  observations?: string[];
  executedWell?: boolean;
}

/** FlightDebrief.PartiallyGenerated: each field arrives when the model has produced it. */
export interface PartialFlightDebrief {
  narrativeSummary?: string;
  phaseObservations?: PartialPhaseObservation[];
  improvements?: string[];
  overallRating?: number;
}

export interface DebriefEngineState {
  availability: DebriefAvailability;
  isGenerating: boolean;
  /** The streaming result, while it is being generated. */
  partial: PartialFlightDebrief | null;
  /** The finished debrief: just generated, or loaded from the recording database. */
  completed: FlightDebrief | null;
  /** A failure of the model or of saving the result (an Error; its message is shown). */
  error: unknown;
}

export interface DebriefEngine {
  readonly state: DebriefEngineState;
  /** Calls the listener after every change of `state`; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Asks the platform whether the on-device model can run, and fills `state.availability`. */
  checkAvailability(): void;
  /** Starts loading the model so the first response is faster (a no-op unless available). */
  prewarm(): void;
  /** Streams the debrief for the prompt into `state.partial`, then `completed`, and saves it with the flight. */
  generateDebrief(prompt: string, flightId: string): Promise<void>;
  /** Fills `state.completed` from the saved debrief of the flight, if there is one. */
  loadExistingDebrief(flightId: string): Promise<void>;
  /** Frees the session (about 1.2 GB of model memory) and clears the state. */
  discard(): void;
}

const emptyState = (availability: DebriefAvailability): DebriefEngineState => ({
  availability,
  isGenerating: false,
  partial: null,
  completed: null,
  error: null,
});

/** What a FakeDebriefEngine does when asked to generate: stream with `engine.emit`, then return the debrief or throw. */
export type GenerationScript = (engine: FakeDebriefEngine) => Promise<FlightDebrief>;

/** In-memory DebriefEngine for tests and the screenshot fixtures. */
export class FakeDebriefEngine implements DebriefEngine {
  state: DebriefEngineState = emptyState({ kind: 'unknown' });
  private listeners = new Set<() => void>();
  readonly generated: { prompt: string; flightId: string }[] = [];
  readonly loaded: string[] = [];
  prewarmCalls = 0;
  discardCalls = 0;
  availabilityChecks = 0;

  constructor(
    /** What checkAvailability finds. */
    public availability: DebriefAvailability = { kind: 'available' },
    /** The saved debrief loadExistingDebrief finds. */
    public stored: FlightDebrief | null = null,
    /** What generating does; by default it finishes at once with `stored`, or a small debrief. */
    public script: GenerationScript = async () => this.stored ?? FAKE_DEBRIEF,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Changes the state the way the real engine does, and tells the listeners. */
  emit(patch: Partial<DebriefEngineState>): void {
    this.state = { ...this.state, ...patch };
    [...this.listeners].forEach((listener) => listener());
  }

  checkAvailability(): void {
    this.availabilityChecks += 1;
    this.emit({ availability: this.availability });
  }

  prewarm(): void {
    if (this.state.availability.kind === 'available') this.prewarmCalls += 1;
  }

  async generateDebrief(prompt: string, flightId: string): Promise<void> {
    this.generated.push({ prompt, flightId });
    this.emit({ isGenerating: true, error: null, partial: null, completed: null });
    try {
      const debrief = await this.script(this);
      this.emit({ completed: debrief });
    } catch (error) {
      this.emit({ error });
    } finally {
      this.emit({ isGenerating: false });
    }
  }

  async loadExistingDebrief(flightId: string): Promise<void> {
    this.loaded.push(flightId);
    if (this.stored) this.emit({ completed: this.stored });
  }

  discard(): void {
    this.discardCalls += 1;
    this.emit({ partial: null, completed: null, error: null });
  }
}

/** A finished debrief for fixtures. */
export const FAKE_DEBRIEF: FlightDebrief = {
  narrativeSummary: 'A short pattern flight in good conditions.',
  phaseObservations: [{ phase: 'takeoff', observations: ['Smooth rotation.'], executedWell: true }],
  improvements: ['Hold the climb speed steady.'],
  overallRating: 4,
};
