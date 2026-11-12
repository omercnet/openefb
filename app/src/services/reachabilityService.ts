// Port of ReachabilityService (Services/ReachabilityService.swift): network status for the "operating with cached data"
// indication. Swift wraps NWPathMonitor; here the platform sits behind `NetworkStatusSource`. No native implementation
// ships in this port: it needs a network-status module (expo-network or netinfo) that is not a dependency yet, so the
// adapter is added with the app wiring (I1) together with that dependency.
export interface NetworkStatus {
  isConnected: boolean;
  /** Cellular or otherwise metered connection. */
  isExpensive: boolean;
}

export interface NetworkStatusSource {
  /** Starts delivering status changes (the first call may deliver the current status). Returns the unsubscribe function. */
  subscribe(listener: (status: NetworkStatus) => void): () => void;
}

export class ReachabilityService {
  isConnected = false;
  isExpensive = false;

  private unsubscribe: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(private readonly source: NetworkStatusSource) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getVersion = (): number => this.version;

  /** Starts monitoring. Calling it again while running does nothing (no second subscription). */
  start(): void {
    if (this.unsubscribe) return;
    let active = true;
    const unsubscribe = this.source.subscribe((status) => {
      if (!active) return; // a callback that arrives after stop() is ignored
      this.isConnected = status.isConnected === true;
      this.isExpensive = status.isExpensive === true;
      this.version += 1;
      for (const listener of [...this.listeners]) {
        try {
          listener();
        } catch {
          // a throwing listener must not stop the others or the monitor
        }
      }
    });
    this.unsubscribe = () => {
      active = false;
      unsubscribe();
    };
  }

  stop(): void {
    const unsubscribe = this.unsubscribe;
    this.unsubscribe = null;
    unsubscribe?.();
  }
}
