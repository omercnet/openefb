// New in TS: the expo-location adapter (Swift CLLocationUpdate wiring had no unit tests).
import type * as ExpoLocation from 'expo-location';

import type { LocationListener } from '../domain/ports/location';
import type * as LocationAdapter from './location';

type TaskExecutor = (body: {
  data?: { locations: ExpoLocation.LocationObject[] };
  error?: { message: string } | null;
}) => Promise<void>;

const mockTasks = new Map<string, TaskExecutor>();

jest.mock('expo-task-manager', () => ({
  defineTask: (name: string, executor: TaskExecutor) => mockTasks.set(name, executor),
}));

jest.mock('expo-location', () => ({
  Accuracy: { BestForNavigation: 6 },
  ActivityType: { OtherNavigation: 4, Airborne: 5 },
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  hasServicesEnabledAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
}));

// The adapter keeps module state (the background fan-out), so each test loads a fresh copy.
let adapter: typeof LocationAdapter;
let Location: jest.Mocked<typeof ExpoLocation>;

function flush(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
}

function loc(
  overrides: Partial<ExpoLocation.LocationObject['coords']> = {},
  timestamp = 1_800_000_000_000,
): ExpoLocation.LocationObject {
  return {
    timestamp,
    coords: {
      latitude: 32,
      longitude: 35,
      altitude: 100,
      accuracy: 5,
      altitudeAccuracy: 8,
      heading: 90,
      speed: 10,
      ...overrides,
    },
  };
}

function listener(): jest.Mocked<LocationListener> {
  return { onUpdate: jest.fn(), onError: jest.fn() };
}

beforeEach(() => {
  jest.resetModules();
  mockTasks.clear();
  Location = jest.requireMock('expo-location');
  jest.clearAllMocks();
  Location.hasServicesEnabledAsync.mockResolvedValue(true);
  Location.getForegroundPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted' } as never);
  Location.startLocationUpdatesAsync.mockResolvedValue();
  Location.stopLocationUpdatesAsync.mockResolvedValue();
  adapter = jest.requireActual('./location');
});

describe('fixFromLocationObject', () => {
  it('copies values and maps missing ones to -1 (invalid)', () => {
    expect(adapter.fixFromLocationObject(loc())).toEqual({
      lat: 32,
      lon: 35,
      altitudeM: 100,
      horizontalAccuracyM: 5,
      verticalAccuracyM: 8,
      speedMps: 10,
      courseDeg: 90,
      timestampMs: 1_800_000_000_000,
    });
    expect(
      adapter.fixFromLocationObject(
        loc({ altitude: null, accuracy: null, altitudeAccuracy: null, heading: null, speed: null }),
      ),
    ).toMatchObject({ altitudeM: 0, horizontalAccuracyM: -1, verticalAccuracyM: -1, speedMps: -1, courseDeg: -1 });
    expect(adapter.fixFromLocationObject(loc({ altitude: null })).verticalAccuracyM).toBe(-1);
  });
});

describe('createLocationSource', () => {
  it('foreground: watches at 1 Hz best-for-navigation and stops the watch', async () => {
    const remove = jest.fn();
    let deliver: (l: ExpoLocation.LocationObject) => void = () => undefined;
    Location.watchPositionAsync.mockImplementation(async (_o, cb) => {
      deliver = cb;
      return { remove };
    });
    const l = listener();
    const sub = adapter.createLocationSource().subscribe({ activity: 'otherNavigation', background: false }, l);
    await flush();
    expect(Location.watchPositionAsync).toHaveBeenCalledWith(
      { accuracy: 6, timeInterval: 1000, distanceInterval: 0 },
      expect.any(Function),
      expect.any(Function),
    );
    deliver(loc());
    expect(l.onUpdate).toHaveBeenCalledWith({ fix: expect.objectContaining({ lat: 32 }) });
    sub.stop();
    expect(remove).toHaveBeenCalled();
    deliver(loc());
    expect(l.onUpdate).toHaveBeenCalledTimes(1);
  });

  it('foreground: a watch error fails the subscription once', async () => {
    let onErr: (reason: string) => void = () => undefined;
    const remove = jest.fn();
    Location.watchPositionAsync.mockImplementation(async (_o, _cb, err) => {
      onErr = err!;
      return { remove };
    });
    const l = listener();
    adapter.createLocationSource().subscribe({ activity: 'otherNavigation', background: false }, l);
    await flush();
    onErr('kCLErrorDomain 1');
    onErr('again');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(l.onError).toHaveBeenCalledTimes(1);
    expect(l.onError).toHaveBeenCalledWith(new Error('kCLErrorDomain 1'));
  });

  it('a stop before the permission check finishes never starts the watch', async () => {
    const remove = jest.fn();
    Location.watchPositionAsync.mockResolvedValue({ remove });
    const sub = adapter
      .createLocationSource()
      .subscribe({ activity: 'otherNavigation', background: false }, listener());
    sub.stop();
    await flush();
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('a stop while the watch is being created removes it once it resolves', async () => {
    const remove = jest.fn();
    let resolveWatch: (sub: { remove: () => void }) => void = () => undefined;
    Location.watchPositionAsync.mockReturnValue(new Promise((r) => (resolveWatch = r)) as never);
    const sub = adapter
      .createLocationSource()
      .subscribe({ activity: 'otherNavigation', background: false }, listener());
    await flush();
    expect(Location.watchPositionAsync).toHaveBeenCalled();
    sub.stop();
    resolveWatch({ remove });
    await flush();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('reports Location Services off as denied globally and does not start', async () => {
    Location.hasServicesEnabledAsync.mockResolvedValue(false);
    const l = listener();
    adapter.createLocationSource().subscribe({ activity: 'otherNavigation', background: false }, l);
    await flush();
    expect(l.onUpdate).toHaveBeenCalledWith({ fix: null, authorizationDeniedGlobally: true });
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
  });

  it('reports a denied permission; an undetermined one reports nothing', async () => {
    Location.getForegroundPermissionsAsync.mockResolvedValue({ granted: false, status: 'denied' } as never);
    const denied = listener();
    adapter.createLocationSource().subscribe({ activity: 'otherNavigation', background: false }, denied);
    await flush();
    expect(denied.onUpdate).toHaveBeenCalledWith({ fix: null, authorizationDenied: true });

    Location.getForegroundPermissionsAsync.mockResolvedValue({ granted: false, status: 'undetermined' } as never);
    const unasked = listener();
    adapter.createLocationSource().subscribe({ activity: 'otherNavigation', background: false }, unasked);
    await flush();
    expect(unasked.onUpdate).not.toHaveBeenCalled();
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
  });

  it('background: one task serves all subscribers and stops with the last', async () => {
    const source = adapter.createLocationSource();
    const a = listener();
    const b = listener();
    const subA = source.subscribe({ activity: 'airborne', background: true }, a);
    const subB = source.subscribe({ activity: 'otherNavigation', background: true }, b);
    await flush();
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledWith(
      adapter.LOCATION_TASK,
      expect.objectContaining({
        accuracy: 6,
        activityType: 5,
        timeInterval: 1000,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: { ...adapter.FOREGROUND_SERVICE_NOTIFICATION, killServiceOnDestroy: true },
      }),
    );

    const task = mockTasks.get(adapter.LOCATION_TASK)!;
    await task({ data: { locations: [loc({}, 1), loc({}, 2)] }, error: null });
    expect(a.onUpdate).toHaveBeenCalledTimes(2);
    expect(b.onUpdate.mock.calls.map(([u]) => u.fix?.timestampMs)).toEqual([1, 2]);

    subA.stop();
    expect(Location.stopLocationUpdatesAsync).not.toHaveBeenCalled();
    subB.stop();
    expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledWith(adapter.LOCATION_TASK);
  });

  it('background: a listener stopped by an earlier listener in the same delivery is not called', async () => {
    const source = adapter.createLocationSource();
    const a = listener();
    const b = listener();
    source.subscribe({ activity: 'airborne', background: true }, a);
    const subB = source.subscribe({ activity: 'airborne', background: true }, b);
    await flush();
    a.onUpdate.mockImplementation(() => subB.stop());
    await mockTasks.get(adapter.LOCATION_TASK)!({ data: { locations: [loc({}, 1)] }, error: null });
    expect(a.onUpdate).toHaveBeenCalledTimes(1);
    expect(b.onUpdate).not.toHaveBeenCalled();
  });

  it('background: a task error fails every subscriber and stops updates', async () => {
    const source = adapter.createLocationSource();
    const a = listener();
    source.subscribe({ activity: 'airborne', background: true }, a);
    await flush();
    await mockTasks.get(adapter.LOCATION_TASK)!({ error: { message: 'boom' } });
    expect(a.onError).toHaveBeenCalledWith(new Error('boom'));
    expect(Location.stopLocationUpdatesAsync).toHaveBeenCalled();
  });

  it('background: a failed start fails the subscriber', async () => {
    Location.startLocationUpdatesAsync.mockRejectedValue(new Error('Not authorized'));
    const a = listener();
    adapter.createLocationSource().subscribe({ activity: 'airborne', background: true }, a);
    await flush();
    expect(a.onError).toHaveBeenCalledWith(new Error('Not authorized'));
  });

  it('requestPermission asks foreground first, then background', async () => {
    Location.requestForegroundPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true } as never);
    Location.requestBackgroundPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false } as never);
    const source = adapter.createLocationSource();
    await expect(source.requestPermission('foreground')).resolves.toEqual({ granted: true, canAskAgain: true });
    expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    await expect(source.requestPermission('background')).resolves.toEqual({ granted: false, canAskAgain: false });

    Location.requestForegroundPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false } as never);
    Location.requestBackgroundPermissionsAsync.mockClear();
    await expect(source.requestPermission('background')).resolves.toEqual({ granted: false, canAskAgain: false });
    expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });
});
