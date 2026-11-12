// One download at a time for a store, with ownership: a run that was aborted or replaced can never write state after a
// newer run (or a remove) took over. Platform-free.
export class DownloadSlot {
  private current: { id: number; controller: AbortController; done: Promise<void>; valid: boolean } | null = null;
  private seq = 0;

  get active(): boolean {
    return this.current !== null;
  }

  /** Starts `work` unless one is running. `isCurrent()` is true only while this run is the live, un-invalidated one:
   * check it before every state write that follows an await. Resolves false when a run is already active. */
  start(work: (signal: AbortSignal, isCurrent: () => boolean) => Promise<void>): boolean {
    if (this.current) return false;
    const id = ++this.seq;
    const controller = new AbortController();
    const entry = { id, controller, valid: true, done: Promise.resolve() };
    const isCurrent = () => this.current === entry && entry.valid;
    this.current = entry;
    entry.done = (async () => {
      try {
        await work(controller.signal, isCurrent);
      } finally {
        if (this.current === entry) this.current = null;
      }
    })().catch(() => undefined);
    return true;
  }

  /** Aborts the running download and waits until it has stopped. With `invalidate`, the run's own handlers see
   * `isCurrent() === false` from now on (use before removing the pack). */
  async abort(options: { invalidate?: boolean } = {}): Promise<void> {
    const entry = this.current;
    if (!entry) return;
    if (options.invalidate) entry.valid = false;
    entry.controller.abort();
    await entry.done;
  }
}
