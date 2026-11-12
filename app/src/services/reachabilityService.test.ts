// ReachabilityService has no Swift test (it wraps NWPathMonitor); these tests cover the port's behaviour.
import { ReachabilityService, type NetworkStatus, type NetworkStatusSource } from './reachabilityService';

function fakeSource() {
  const listeners = new Set<(s: NetworkStatus) => void>();
  let unsubscribes = 0;
  const source: NetworkStatusSource = {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        unsubscribes += 1;
        listeners.delete(listener);
      };
    },
  };
  return {
    source,
    emit: (s: NetworkStatus) => [...listeners].forEach((l) => l(s)),
    count: () => listeners.size,
    unsubscribes: () => unsubscribes,
  };
}

test('starts offline, follows the source, and notifies observers', () => {
  const fake = fakeSource();
  const service = new ReachabilityService(fake.source);
  let notified = 0;
  service.subscribe(() => (notified += 1));
  expect([service.isConnected, service.isExpensive]).toEqual([false, false]);
  service.start();
  fake.emit({ isConnected: true, isExpensive: true });
  expect([service.isConnected, service.isExpensive]).toEqual([true, true]);
  fake.emit({ isConnected: false, isExpensive: false });
  expect([service.isConnected, service.isExpensive]).toEqual([false, false]);
  expect(notified).toBe(2);
});

test('start is idempotent and stop releases the subscription', () => {
  const fake = fakeSource();
  const service = new ReachabilityService(fake.source);
  service.start();
  service.start();
  expect(fake.count()).toBe(1);
  service.stop();
  service.stop();
  expect(fake.unsubscribes()).toBe(1);
  expect(fake.count()).toBe(0);
  service.start(); // can be restarted
  expect(fake.count()).toBe(1);
});

test('a status delivered after stop is ignored, and a throwing observer does not break the others', () => {
  const stale: ((s: NetworkStatus) => void)[] = [];
  const service = new ReachabilityService({
    subscribe: (listener) => {
      stale.push(listener);
      return () => undefined; // a source that keeps delivering after unsubscribe
    },
  });
  const seen: boolean[] = [];
  service.subscribe(() => {
    throw new Error('bad observer');
  });
  service.subscribe(() => seen.push(service.isConnected));
  service.start();
  stale[0]({ isConnected: true, isExpensive: false });
  expect(seen).toEqual([true]);
  service.stop();
  stale[0]({ isConnected: false, isExpensive: false });
  expect(service.isConnected).toBe(true);
  expect(seen).toEqual([true]);
});
