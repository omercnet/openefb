import { createSerialQueue } from './serialQueue';

describe('createSerialQueue', () => {
  it('runs jobs one at a time in call order, even when an earlier one is slow', async () => {
    const enqueue = createSerialQueue();
    const gate = Promise.withResolvers<void>();
    const order: string[] = [];
    const first = enqueue(async () => {
      order.push('first start');
      await gate.promise;
      order.push('first end');
      return 1;
    });
    const second = enqueue(() => {
      order.push('second');
      return Promise.resolve(2);
    });
    // A queue that ran the second job alongside the first would record 'second' before 'first end'.
    gate.resolve();
    expect(await Promise.all([first, second])).toEqual([1, 2]);
    expect(order).toEqual(['first start', 'first end', 'second']);
  });

  it('a job that rejects rejects its own promise and does not stop the next job', async () => {
    const enqueue = createSerialQueue();
    const failing = enqueue(() => Promise.reject(new Error('boom')));
    const next = enqueue(() => Promise.resolve('ran'));
    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ran');
  });

  it('a job that throws synchronously is a rejection, not a crash of the queue', async () => {
    const enqueue = createSerialQueue();
    const failing = enqueue(() => {
      throw new Error('sync boom');
    });
    await expect(failing).rejects.toThrow('sync boom');
    await expect(enqueue(() => Promise.resolve('after'))).resolves.toBe('after');
  });

  it('queues are independent of each other', async () => {
    const a = createSerialQueue();
    const b = createSerialQueue();
    const gate = Promise.withResolvers<void>();
    const slow = a(() => gate.promise);
    await expect(b(() => Promise.resolve('b ran'))).resolves.toBe('b ran');
    gate.resolve();
    await slow;
  });
});
