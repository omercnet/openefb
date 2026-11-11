import { fetchWithTimeout, RequestTimeoutError } from './http';
import { response, fakeFetch } from './testSupport';

afterEach(() => jest.useRealTimers());

test('returns the answer and leaves no timer pending', async () => {
  jest.useFakeTimers();
  const fetch = fakeFetch(() => ({ body: 'ok' }));
  const res = await fetchWithTimeout(fetch, 'https://x.test/a', 5000);
  expect(await res.text()).toBe('ok');
  expect(jest.getTimerCount()).toBe(0);
});

test('a request slower than the timeout is aborted and rejects with RequestTimeoutError', async () => {
  jest.useFakeTimers();
  let signal: AbortSignal | undefined;
  const never = (_: string, init?: { signal?: AbortSignal }) => {
    signal = init?.signal;
    return new Promise<never>(() => undefined);
  };
  const pending = fetchWithTimeout(never, 'https://x.test/a', 5000);
  const assertion = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError);
  jest.advanceTimersByTime(5000);
  await assertion;
  expect(signal?.aborted).toBe(true);
});

test('a synchronous throw from fetch becomes a rejection and clears the timer', async () => {
  jest.useFakeTimers();
  const boom = () => {
    throw new Error('offline');
  };
  await expect(fetchWithTimeout(boom, 'https://x.test/a', 5000)).rejects.toThrow('offline');
  expect(jest.getTimerCount()).toBe(0);
});

test('a request that fails after the timeout does not raise an unhandled rejection', async () => {
  jest.useFakeTimers();
  let fail: (e: Error) => void = () => undefined;
  const late = () => new Promise<ReturnType<typeof response>>((_, reject) => (fail = reject));
  const pending = fetchWithTimeout(late, 'https://x.test/a', 10);
  const assertion = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError);
  jest.advanceTimersByTime(10);
  await assertion;
  fail(new Error('aborted'));
  await Promise.resolve();
});
