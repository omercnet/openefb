import { createFakeNetworkStatus, isOfflineFromNetInfo } from './network';

describe('network status', () => {
  it('reads offline only when the platform says there is no connection', () => {
    expect(isOfflineFromNetInfo({ isConnected: false })).toBe(true);
    expect(isOfflineFromNetInfo({ isConnected: true })).toBe(false);
    // Unknown (null) is not a claim of being offline: the banner never shows on a guess.
    expect(isOfflineFromNetInfo({ isConnected: null })).toBe(false);
  });

  it('the fake reports the current value on subscribe and every change after, until unsubscribed', () => {
    const net = createFakeNetworkStatus(false);
    const seen: boolean[] = [];
    const stop = net.subscribe((offline) => seen.push(offline));
    net.set(true);
    net.set(true);
    net.set(false);
    stop();
    net.set(true);
    expect(seen).toEqual([false, true, false]);
  });
});
