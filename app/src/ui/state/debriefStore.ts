import { createStore, type StoreApi } from 'zustand';
import type { FlightDebrief } from '../../domain/debrief/types';
import type { AppError } from '../../domain/errors';
import type { DebriefEngine, PartialFlightDebrief } from '../../domain/ports/debriefEngine';

// The state of the AI debrief screen (efb-212/Views/Flights/DebriefView.swift): the DebriefEngine's state, which the view reads, and
// the error of building the prompt, which the engine never sees (the view tracks it itself), with the three things its buttons do.

export interface DebriefViewDeps {
  engine: DebriefEngine;
  flightId: string;
  /** The prompt for the flight (domain/debrief/debriefPrompt); rejects when the recording database cannot be read. */
  buildPrompt(): Promise<string>;
}

export interface DebriefViewState {
  // The engine's state, mirrored.
  isGenerating: boolean;
  partial: PartialFlightDebrief | null;
  completed: FlightDebrief | null;
  engineError: unknown;

  /** Building the prompt failed (a recording database read), or the engine itself threw. */
  promptError: AppError | null;

  /** onAppear: shows the debrief saved for the flight, if there is one. */
  loadExisting(): Promise<void>;
  /** "Generate Debrief" and "Try Again". */
  generate(): Promise<void>;
  /** "Regenerate Debrief": clears the engine's state, then generates. */
  regenerate(): Promise<void>;
  /** Stops following the engine. */
  dispose(): void;
}

export type DebriefViewStore = StoreApi<DebriefViewState>;

const debriefFailure = (cause: unknown): AppError => ({ kind: 'debriefFailed', cause });

export function createDebriefStore(deps: DebriefViewDeps): DebriefViewStore {
  const { engine } = deps;
  /** A prompt is being built or a debrief generated: a second tap must not start another (Swift would stream twice). */
  let busy = false;
  let unsubscribe = () => {};

  const mirror = () => ({
    isGenerating: engine.state.isGenerating,
    partial: engine.state.partial,
    completed: engine.state.completed,
    engineError: engine.state.error,
  });

  const store = createStore<DebriefViewState>()((set, get) => ({
    ...mirror(),
    promptError: null,

    async loadExisting() {
      try {
        await engine.loadExistingDebrief(deps.flightId);
      } catch (error) {
        set({ promptError: debriefFailure(error) });
      }
    },

    async generate() {
      if (busy) return;
      busy = true;
      set({ promptError: null });
      try {
        let prompt: string;
        try {
          prompt = await deps.buildPrompt();
        } catch (error) {
          // The engine never sees the prompt in that case: surface it so the pilot can retry instead of seeing nothing.
          set({ promptError: debriefFailure(error) });
          return;
        }
        try {
          await engine.generateDebrief(prompt, deps.flightId);
        } catch (error) {
          set({ promptError: debriefFailure(error) }); // the engine records its own errors; this is an adapter that threw
        }
      } finally {
        busy = false;
      }
    },

    async regenerate() {
      if (busy) return;
      engine.discard();
      await get().generate();
    },

    dispose: () => unsubscribe(),
  }));

  unsubscribe = engine.subscribe(() => store.setState(mirror()));
  return store;
}
