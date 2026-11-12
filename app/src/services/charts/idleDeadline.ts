// A deadline that resets on progress: the connect deadline is the first window, every progress report restarts it, so a
// transfer that keeps moving bytes is never cut off but a stalled one is. Platform-free.
export class IdleTimeoutError extends Error {
  constructor(readonly idleMs: number) {
    super(`no data for ${idleMs} ms`);
    this.name = 'IdleTimeoutError';
  }
}

export interface IdleDeadline {
  /** Aborts when the idle window passes with no `touch()`. */
  readonly signal: AbortSignal;
  /** The error to report when `signal` aborted because of the idle window; null otherwise. */
  readonly timedOut: IdleTimeoutError | null;
  touch(): void;
  /** Stops the timer. Call when the transfer ends, whatever the outcome. */
  dispose(): void;
}

/** @param outer an external signal (pause, remove): aborting it aborts `signal` too. */
export function idleDeadline(idleMs: number, outer?: AbortSignal): IdleDeadline {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut: IdleTimeoutError | null = null;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = new IdleTimeoutError(idleMs);
      controller.abort();
    }, idleMs);
    (timer as { unref?: () => void }).unref?.();
  };
  const onOuter = () => {
    clearTimeout(timer);
    controller.abort();
  };
  if (outer?.aborted) controller.abort();
  else {
    outer?.addEventListener('abort', onOuter, { once: true });
    arm();
  }
  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    touch() {
      if (!controller.signal.aborted) arm();
    },
    dispose() {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onOuter);
    },
  };
}
