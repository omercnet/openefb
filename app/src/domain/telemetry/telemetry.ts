// The first-party usage counters, in the app (owner decision Q7; replaces Telemetry in Services/TelemetryService.swift, which fed
// TelemetryDeck). signal() counts what happened under the app version, platform, OTA update and region; flush() sends the counts
// to the Worker in web/telemetry; setEnabled() is the Settings toggle "Share anonymous usage data" (Swift key `telemetryEnabled`,
// on until the pilot turns it off). A count has no time stamp, no id and no order, so it cannot say when or to whom anything
// happened.
//
// Races this class is written against: a flush that is already running is joined, never doubled; a result that comes back
// after the choice changed (opt-out, or opt-out and in again) is stale and keeps nothing; the storage is touched one operation
// at a time, in the order things happened, so an older write cannot land after a newer one or after an opt-out's removal;
// nothing is written before the stored backlog has been read, so it cannot be overwritten.
import type { TelemetryStorage, TelemetryTransport } from '../ports/telemetry';
import { CounterBuffer, MAX_BUFFER_KEYS, parseRows, serializeRows } from './counterBuffer';
import { TELEMETRY_SCHEMA, validateRow, type EventName, type SignalArgs } from './schema';

/** Enough requests to send a full buffer in one flush. */
export const MAX_REQUESTS_PER_FLUSH = Math.ceil(MAX_BUFFER_KEYS / TELEMETRY_SCHEMA.maxRows);

/** The dimensions a count is filed under; every field is checked against the schema when a signal is counted. */
export interface TelemetryContext {
  /** x.y.z */
  app: string;
  platform: string;
  /** "embedded" or the OTA update id. */
  update: string;
  region: string;
}

export interface TelemetryDeps {
  storage: TelemetryStorage;
  /** null when no endpoint is configured: nothing is counted or kept then. */
  transport: TelemetryTransport | null;
  /** The context a signal is counted under, read when it happens; null when it is not known (the signal is not counted). */
  context: () => TelemetryContext | null;
}

const ignore = (): void => undefined;

export class Telemetry {
  private readonly buffer = new CounterBuffer();
  /** The choice. On until the stored one says otherwise; off for the session when the stored one cannot be read. */
  private on = true;
  /** setEnabled was called, so the stored choice no longer applies. */
  private chosen = false;
  /** Changes whenever the choice changes: a result that started under an older value is stale. */
  private epoch = 0;
  private loaded = false;
  private loading: Promise<void> | null = null;
  private flushing: Promise<void> | null = null;
  /** The storage queue: every operation waits for the one before it. It never rejects. */
  private io: Promise<unknown> = Promise.resolve();
  private writeQueued = false;

  constructor(private readonly deps: TelemetryDeps) {}

  /** Whether "Share anonymous usage data" is on. Final once start() has resolved. */
  get enabled(): boolean {
    return this.on;
  }

  /** Reads the stored choice and backlog. Safe to call any number of times; signals counted before it ends are kept. */
  start(): Promise<void> {
    this.loading ??= this.load();
    return this.loading;
  }

  /**
   * Counts one thing that happened. Never throws and never waits: a signal that does not fit the schema, a context that is not
   * known (null spreads to nothing, so the row is missing its dimensions and fails the schema) and a pilot who opted out all count
   * nothing. With no endpoint nothing is stored or sent either (see persist and sendCounts).
   */
  signal<E extends EventName>(event: E, ...params: SignalArgs<E>): void {
    try {
      if (!this.on) return;
      const row = validateRow({ event, params: params[0], ...this.deps.context(), count: 1 });
      if (row && this.buffer.add(row)) this.persist();
    } catch {
      // Counting is never worth a failure in the app.
    }
  }

  /**
   * Sends what has been counted, up to 40 rows per request. Joins a flush that is already running. Never rejects: a send that
   * did not go through puts its counts back for the next flush.
   */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    const done = Promise.withResolvers<void>();
    this.flushing = done.promise;
    void this.sendCounts().finally(done.resolve);
    return done.promise;
  }

  /**
   * The Settings toggle. Takes effect at once; off also forgets what was counted, in memory and on the device. Rejects when the
   * choice or the removal could not be stored (the choice still holds for this session).
   */
  async setEnabled(enabled: boolean): Promise<void> {
    this.chosen = true;
    if (enabled !== this.on) {
      this.epoch += 1;
      this.on = enabled;
    }
    if (!enabled) this.buffer.clear();
    const { storage } = this.deps;
    const results = await Promise.allSettled([
      this.enqueue(() => storage.writeEnabled(enabled)),
      ...(enabled ? [] : [this.enqueue(() => storage.removeBacklog())]),
    ]);
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const result = this.io.then(job);
    this.io = result.catch(ignore);
    return result;
  }

  private async load(): Promise<void> {
    const { storage, transport } = this.deps;
    let stored: boolean | null | undefined;
    try {
      stored = await this.enqueue(() => storage.readEnabled());
    } catch {
      stored = undefined; // Unknown is not "on": a pilot who opted out must not be counted because a read failed.
    }
    if (!this.chosen) this.on = stored === true || stored === null;
    if (!this.on) {
      this.buffer.clear(); // What was counted before the stored choice was known.
      // A backlog that an earlier opt-out could not remove must never be sent.
      if (stored === false) this.enqueue(() => storage.removeBacklog()).catch(ignore);
      this.loaded = true;
      return;
    }
    if (transport) {
      let text: string | null = null;
      try {
        text = await this.enqueue(() => storage.readBacklog());
      } catch {
        // An unreadable backlog is no backlog.
      }
      // A pilot who chose while this was reading did not choose with that backlog in sight: it stays unsent.
      if (this.on && !this.chosen) this.buffer.restore(parseRows(text));
    }
    this.loaded = true;
    this.persist();
  }

  /** Writes the backlog (or removes it when empty) after the operations already queued; a burst of changes is one write. */
  private persist(): void {
    if (!this.loaded || !this.deps.transport || this.writeQueued) return;
    this.writeQueued = true;
    this.enqueue(async () => {
      this.writeQueued = false;
      const rows = this.buffer.rows();
      await (rows.length > 0 ? this.deps.storage.writeBacklog(serializeRows(rows)) : this.deps.storage.removeBacklog());
    }).catch(ignore);
  }

  /** Cannot reject: every await in it is guarded (start() and the transport never reject). */
  private async sendCounts(): Promise<void> {
    try {
      await this.start();
      const { transport } = this.deps;
      const epoch = this.epoch;
      for (let request = 0; transport && request < MAX_REQUESTS_PER_FLUSH; request += 1) {
        const batch = this.buffer.drain(TELEMETRY_SCHEMA.maxRows);
        if (batch.length === 0) return;
        this.persist(); // Counts handed to the transport are no longer in the stored backlog: a send is at most once.
        let outcome;
        try {
          outcome = await transport.send(batch);
        } catch {
          outcome = 'retry';
        }
        if (epoch !== this.epoch) return; // The choice changed meanwhile: nothing from this send is kept.
        if (outcome === 'retry') {
          this.buffer.restore(batch);
          this.persist();
          return;
        }
        if (outcome === 'drop') return;
      }
    } finally {
      this.flushing = null;
    }
  }
}
