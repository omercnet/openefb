// Low Power Mode (Swift: ProcessInfo.isLowPowerModeEnabled, read by MapViewModel.refreshDueData, which doubles every refresh
// interval). expo-battery answers asynchronously and notifies on change, so the value is cached and kept current.
import * as Battery from 'expo-battery';

export interface LowPowerSource {
  /** The last known state; false until the first answer (or when the platform cannot say). */
  isEnabled(): boolean;
  stop(): void;
}

/** The part of expo-battery used (the module satisfies it). */
export interface BatteryLike {
  isLowPowerModeEnabledAsync(): Promise<boolean>;
  addLowPowerModeListener(listener: (event: { lowPowerMode: boolean }) => void): { remove(): void };
}

export function createLowPowerMode(battery: BatteryLike = Battery): LowPowerSource {
  let enabled = false;
  let stopped = false;
  battery.isLowPowerModeEnabledAsync().then(
    (value) => {
      if (!stopped) enabled = value;
    },
    () => undefined, // the platform cannot say: the normal intervals apply
  );
  const subscription = battery.addLowPowerModeListener((event) => {
    enabled = event.lowPowerMode;
  });
  return {
    isEnabled: () => enabled,
    stop() {
      stopped = true;
      subscription.remove();
    },
  };
}
