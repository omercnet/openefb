import { idleDeadline, IdleTimeoutError } from './idleDeadline';
import { joinPath } from './pathJoin';

afterEach(() => jest.useRealTimers());

test('a transfer that keeps reporting progress is not cut off; a stalled one is, with IdleTimeoutError', () => {
  jest.useFakeTimers();
  const d = idleDeadline(1000);
  jest.advanceTimersByTime(900);
  d.touch();
  jest.advanceTimersByTime(900);
  expect(d.signal.aborted).toBe(false);
  jest.advanceTimersByTime(200);
  expect(d.signal.aborted).toBe(true);
  expect(d.timedOut).toBeInstanceOf(IdleTimeoutError);
  d.dispose();
});

test('the first window is the connect deadline: no byte at all also times out', () => {
  jest.useFakeTimers();
  const d = idleDeadline(500);
  jest.advanceTimersByTime(500);
  expect(d.timedOut?.idleMs).toBe(500);
});

test('an outer abort aborts without a timeout error, a late touch is ignored, and dispose clears the timer', () => {
  jest.useFakeTimers();
  const outer = new AbortController();
  const d = idleDeadline(1000, outer.signal);
  outer.abort();
  expect(d.signal.aborted).toBe(true);
  expect(d.timedOut).toBeNull();
  d.touch();
  expect(jest.getTimerCount()).toBe(0);
  const already = new AbortController();
  already.abort();
  expect(idleDeadline(1000, already.signal).signal.aborted).toBe(true);
  const e = idleDeadline(1000);
  e.dispose();
  expect(jest.getTimerCount()).toBe(0);
});

test('joinPath keeps the file:/// root, collapses repeated slashes elsewhere, and handles plain paths', () => {
  expect(joinPath('file:///data/app', 'charts', 'x.json')).toBe('file:///data/app/charts/x.json');
  expect(joinPath('file:///', 'a')).toBe('file:///a');
  expect(joinPath('file:///data/app/', 'a')).toBe('file:///data/app/a');
  expect(joinPath('file:///a//b', 'c')).toBe('file:///a/b/c');
  expect(joinPath('https://h.example/x', 'y')).toBe('https://h.example/x/y');
  expect(joinPath('/root', 'a', 'b')).toBe('/root/a/b');
  expect(joinPath('/root//a', '/b')).toBe('/root/a/b');
});
