// What the usage counters need from the platform: somewhere to keep the choice and the unsent counts, and a way to send
// them. Adapters: src/adapters/telemetryStorage.ts and telemetryTransport.ts. The fakes below are for tests.
import type { CounterRow } from '../telemetry/schema';

/** What the server made of one batch. */
export type SendOutcome =
  /** Taken (or taken apart: rows it did not know are dropped on its side), so the rows are done with. */
  | 'sent'
  /** Not delivered and worth trying again later: no network, a timeout, a server that is down or busy. */
  | 'retry'
  /** Refused for good (the batch itself is wrong); trying again would be refused the same way. */
  | 'drop';

export interface TelemetryTransport {
  /** Sends one batch (at most `TELEMETRY_SCHEMA.maxRows` rows). Resolves with what became of it. */
  send(rows: readonly CounterRow[]): Promise<SendOutcome>;
}

export interface TelemetryStorage {
  /** The pilot's choice for "Share anonymous usage data", or null when never made (the default is on). */
  readEnabled(): Promise<boolean | null>;
  writeEnabled(enabled: boolean): Promise<void>;
  /** The counts not sent yet, as `serializeRows` wrote them. */
  readBacklog(): Promise<string | null>;
  writeBacklog(text: string): Promise<void>;
  removeBacklog(): Promise<void>;
}

export type TelemetryStorageOp = 'readEnabled' | 'writeEnabled' | 'readBacklog' | 'writeBacklog' | 'removeBacklog';

/** In-memory storage that records its calls, can fail an operation, and can hold one until a test releases it. */
export class FakeTelemetryStorage implements TelemetryStorage {
  enabled: boolean | null = null;
  backlog: string | null = null;
  /** Every operation, in the order it was started. */
  readonly calls: TelemetryStorageOp[] = [];
  /** Every value the backlog took, in order: the text written, or null for a removal. */
  readonly backlogHistory: (string | null)[] = [];
  readonly failures = new Map<TelemetryStorageOp, Error>();
  private readonly holds = new Map<TelemetryStorageOp, PromiseWithResolvers<void>>();

  /** Makes the next calls of `op` wait (as a slow disk would) until `release(op)`. */
  hold(op: TelemetryStorageOp): void {
    this.holds.set(op, Promise.withResolvers<void>());
  }

  release(op: TelemetryStorageOp): void {
    this.holds.get(op)?.resolve();
    this.holds.delete(op);
  }

  private async enter(op: TelemetryStorageOp): Promise<void> {
    this.calls.push(op);
    await this.holds.get(op)?.promise;
    const failure = this.failures.get(op);
    if (failure) throw failure;
  }

  async readEnabled(): Promise<boolean | null> {
    await this.enter('readEnabled');
    return this.enabled;
  }

  async writeEnabled(enabled: boolean): Promise<void> {
    await this.enter('writeEnabled');
    this.enabled = enabled;
  }

  async readBacklog(): Promise<string | null> {
    await this.enter('readBacklog');
    return this.backlog;
  }

  async writeBacklog(text: string): Promise<void> {
    await this.enter('writeBacklog');
    this.backlog = text;
    this.backlogHistory.push(text);
  }

  async removeBacklog(): Promise<void> {
    await this.enter('removeBacklog');
    this.backlog = null;
    this.backlogHistory.push(null);
  }
}

/** Records the batches it is given and answers with scripted outcomes; can hold an answer until a test releases it. */
export class FakeTelemetryTransport implements TelemetryTransport {
  /** Every batch handed over, as copies. */
  readonly batches: CounterRow[][] = [];
  /** Handed out one per send; 'sent' when they run out. An Error makes that send reject. */
  outcomes: (SendOutcome | Error)[] = [];
  /** Makes `send` throw instead of returning a promise (an adapter bug the facade must survive). */
  throwSynchronously: Error | null = null;
  holding = false;
  private readonly pending: PromiseWithResolvers<SendOutcome>[] = [];

  get heldCount(): number {
    return this.pending.length;
  }

  send(rows: readonly CounterRow[]): Promise<SendOutcome> {
    this.batches.push(structuredClone([...rows]));
    if (this.throwSynchronously) throw this.throwSynchronously;
    if (this.holding) {
      const held = Promise.withResolvers<SendOutcome>();
      this.pending.push(held);
      return held.promise;
    }
    const outcome = this.outcomes.shift() ?? 'sent';
    return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
  }

  /** Answers the oldest held send. */
  release(outcome: SendOutcome | Error = 'sent'): void {
    const held = this.pending.shift();
    if (!held) throw new Error('no send is held');
    if (outcome instanceof Error) held.reject(outcome);
    else held.resolve(outcome);
  }
}
