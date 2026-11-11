/** Runs jobs one at a time in call order: a slow earlier job can never finish after a later one. */
export type SerialQueue = <T>(job: () => Promise<T>) => Promise<T>;

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return (job) => {
    // A job that rejects rejects its own promise; the queue goes on with the next one.
    const run = tail.then(job);
    tail = run.then(undefined, () => undefined);
    return run;
  };
}
