// DebriefModel over Apple FoundationModels, through the local KanafDebrief Expo module (modules/kanaf-debrief). The plan
// preferred a React Native library for this (react-native-apple-llm) and allowed a small local module if it proved too
// immature (risk R4); the debrief needs guided generation of one fixed type with streamed snapshots, which the module does
// in about 100 lines of Swift. Differences from the Swift engine: docs/port-notes/A6.md.
import { requireOptionalNativeModule, type EventSubscription } from 'expo';

import { parseFlightDebrief, parsePartialFlightDebrief } from '../domain/debriefResponse';
import {
  DebriefError,
  type DebriefModel,
  type DebriefSession,
  type ModelAvailability,
  type PartialFlightDebrief,
} from '../domain/ports/debriefModel';
import type { FlightDebrief } from '../domain/debrief/types';

export interface NativeAvailability {
  status: 'available' | 'unavailable';
  /** Swift `String(describing: reason)` of SystemLanguageModel.Availability.UnavailableReason. */
  reason?: string;
}

/** One snapshot of the debrief being generated: the JSON of its GeneratedContent so far. */
export interface NativePartialEvent {
  requestId: number;
  json: string;
}

/** What the native module offers, as far as this adapter uses it. */
export interface KanafDebriefModule {
  addListener(event: 'onPartial', listener: (event: NativePartialEvent) => void): EventSubscription;
  availability(): NativeAvailability;
  /** Replaces any open session and returns the new session's id. Throws when iOS is older than 26. */
  openSession(instructions: string): number;
  /**
   * Streams snapshots as `onPartial` events tagged with `requestId`; resolves with the final debrief as JSON text. Rejects with
   * ERR_DEBRIEF_NO_SESSION when `sessionId` is not the open session.
   */
  generate(sessionId: number, requestId: number, prompt: string): Promise<string>;
  /** Cancels a generation in progress (its promise rejects) and releases the session; a no-op unless `sessionId` is the open one. */
  closeSession(sessionId: number): void;
}

/** The native module, or null where it is not linked (Android, web, a binary built without it). */
export function loadKanafDebrief(): KanafDebriefModule | null {
  return requireOptionalNativeModule<KanafDebriefModule>('KanafDebrief');
}

let lastRequestId = 0;

class FoundationModelsSession implements DebriefSession {
  private closed = false;
  private readonly listening = new Set<EventSubscription>();

  constructor(
    private readonly native: KanafDebriefModule,
    private readonly sessionId: number,
  ) {}

  async generate(prompt: string, onPartial: (partial: PartialFlightDebrief) => void): Promise<FlightDebrief> {
    if (this.closed) throw new DebriefError('sessionUnavailable');
    lastRequestId += 1;
    const requestId = lastRequestId;
    // Listen before starting so the first snapshot is not missed; each generation hears only its own request.
    const subscription = this.native.addListener('onPartial', (event) => {
      if (event.requestId !== requestId) return;
      const partial = parsePartialFlightDebrief(event.json);
      if (partial) onPartial(partial);
    });
    this.listening.add(subscription);

    let json: unknown;
    try {
      json = await this.native.generate(this.sessionId, requestId, prompt);
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      subscription.remove();
      this.listening.delete(subscription);
    }
    if (typeof json !== 'string' || json.trim() === '') throw new DebriefError('emptyResponse');
    return parseFlightDebrief(json);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.listening.forEach((subscription) => subscription.remove());
    this.listening.clear();
    this.native.closeSession(this.sessionId);
  }
}

export function createFoundationModelsDebriefModel(
  native: KanafDebriefModule | null = loadKanafDebrief(),
): DebriefModel {
  return {
    offered: true,

    availability(): ModelAvailability {
      if (!native) return { kind: 'unavailable', reason: 'moduleNotLinked' };
      const result = native.availability();
      if (result.status === 'available') return { kind: 'available' };
      return { kind: 'unavailable', reason: typeof result.reason === 'string' ? result.reason : '' };
    },

    openSession(instructions: string): DebriefSession {
      if (!native) throw new DebriefError('sessionUnavailable');
      return new FoundationModelsSession(native, native.openSession(instructions));
    },
  };
}
