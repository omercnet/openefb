// LocationSource on expo-location. Foreground: watchPositionAsync. Background: startLocationUpdatesAsync with a
// TaskManager task (an Android foreground service; on iOS UIBackgroundModes location and the blue indicator), which
// replaces CLBackgroundActivitySession. Gaps against CLLocationUpdate are listed in docs/port-notes/A1.md.
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import type {
  LocationFix,
  LocationListener,
  LocationPermission,
  LocationRequest,
  LocationSource,
  LocationSubscription,
} from '../domain/ports/location';

export const LOCATION_TASK = 'kanaf-location';

/** Android foreground-service notification shown while background updates run. */
export const FOREGROUND_SERVICE_NOTIFICATION = {
  notificationTitle: 'Kanaf is using your location',
  notificationBody: 'Tracking your position for the moving map and flight track.',
};

/** Map an expo location to a fix. Missing values become CoreLocation's "invalid" (-1). */
export function fixFromLocationObject(loc: Location.LocationObject): LocationFix {
  const c = loc.coords;
  const hasAltitude = c.altitude !== null && c.altitudeAccuracy !== null;
  return {
    lat: c.latitude,
    lon: c.longitude,
    altitudeM: c.altitude ?? 0,
    horizontalAccuracyM: c.accuracy ?? -1,
    verticalAccuracyM: hasAltitude ? (c.altitudeAccuracy ?? -1) : -1,
    speedMps: c.speed ?? -1,
    courseDeg: c.heading ?? -1, // expo reports the course (direction of travel) as heading
    timestampMs: loc.timestamp,
  };
}

const ACTIVITY: Record<LocationRequest['activity'], Location.ActivityType> = {
  otherNavigation: Location.ActivityType.OtherNavigation,
  airborne: Location.ActivityType.Airborne,
};

// Background fan-out. One task serves every background subscriber; the first subscriber's activity type is used.
const backgroundListeners = new Set<LocationListener>();
let backgroundStart: Promise<void> | null = null;

function failBackground(error: Error): void {
  const listeners = [...backgroundListeners];
  backgroundListeners.clear();
  backgroundStart = null;
  Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => undefined);
  for (const l of listeners) l.onError(error);
}

// Task executors must be defined at module scope so they exist when the OS wakes the app.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    failBackground(new Error(error.message));
    return;
  }
  for (const loc of data?.locations ?? []) {
    const fix = fixFromLocationObject(loc);
    for (const l of [...backgroundListeners]) l.onUpdate({ fix });
  }
});

function startBackground(activity: LocationRequest['activity']): Promise<void> {
  backgroundStart ??= Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    activityType: ACTIVITY[activity],
    timeInterval: 1000, // ms, 1 Hz as the Swift recorder
    distanceInterval: 0,
    pausesUpdatesAutomatically: false, // no stationary pause: expo cannot report it (port-notes A1)
    showsBackgroundLocationIndicator: true,
    foregroundService: { ...FOREGROUND_SERVICE_NOTIFICATION, killServiceOnDestroy: true },
  });
  return backgroundStart;
}

function stopBackground(listener: LocationListener): void {
  if (!backgroundListeners.delete(listener) || backgroundListeners.size > 0) return;
  backgroundStart = null;
  Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => undefined);
}

export function createLocationSource(): LocationSource {
  return {
    subscribe(request, listener) {
      let stopped = false;
      let watch: Location.LocationSubscription | null = null;
      const fail = (e: unknown) => {
        if (stopped) return;
        stopped = true;
        if (request.background) stopBackground(listener);
        listener.onError(e instanceof Error ? e : new Error(String(e)));
      };

      const run = async () => {
        // Swift received these as flags on a position-less update; the stream stayed open.
        if (!(await Location.hasServicesEnabledAsync())) {
          if (!stopped) listener.onUpdate({ fix: null, authorizationDeniedGlobally: true });
          return;
        }
        const permission = await Location.getForegroundPermissionsAsync();
        if (stopped) return;
        if (!permission.granted) {
          // Unasked is not a denial; a later subscribe after requestPermission retries.
          if (permission.status === Location.PermissionStatus.DENIED) {
            listener.onUpdate({ fix: null, authorizationDenied: true });
          }
          return;
        }
        if (request.background) {
          backgroundListeners.add(listener);
          await startBackground(request.activity);
          return;
        }
        const sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
          (loc) => {
            if (!stopped) listener.onUpdate({ fix: fixFromLocationObject(loc) });
          },
          (reason) => fail(new Error(reason)),
        );
        if (stopped) sub.remove();
        else watch = sub;
      };
      run().catch(fail);

      const subscription: LocationSubscription = {
        stop() {
          if (stopped) return;
          stopped = true;
          watch?.remove();
          watch = null;
          if (request.background) stopBackground(listener);
        },
      };
      return subscription;
    },

    async requestPermission(scope): Promise<LocationPermission> {
      const fg = await Location.requestForegroundPermissionsAsync();
      if (scope === 'foreground' || !fg.granted) return { granted: fg.granted, canAskAgain: fg.canAskAgain };
      const bg = await Location.requestBackgroundPermissionsAsync();
      return { granted: bg.granted, canAskAgain: bg.canAskAgain };
    },
  };
}
