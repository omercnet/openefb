// Swift `Haptics` (UINotificationFeedbackGenerator): the warning haptic for proximity and Israel alerts and for a recording
// that starts with the microphone off. expo-haptics maps `notificationAsync(Warning)` to the same generator on iOS and to a
// vibration on Android; a platform without it just does nothing.
import * as ExpoHaptics from 'expo-haptics';

export interface Haptics {
  /** Swift `Haptics.warning()`: an alert was raised, or a recording started with a problem. */
  warning(): void;
  /** Swift `Haptics.success()`: a recording started cleanly, or ended. */
  success(): void;
  /** Swift `Haptics.light()`: a tap on a strip cell, a layer switch, a segmented choice. */
  light(): void;
}

/** The part of expo-haptics used (the module satisfies it). */
export interface HapticsModule {
  notificationAsync(type: ExpoHaptics.NotificationFeedbackType): Promise<void>;
  impactAsync(style: ExpoHaptics.ImpactFeedbackStyle): Promise<void>;
}

export function createHaptics(
  module: HapticsModule = ExpoHaptics,
  log: (message: string) => void = console.warn,
): Haptics {
  // Fire and forget: feedback must never delay or fail what asked for it.
  const run = (play: Promise<void>) => void play.catch((error) => log(`Haptic failed: ${String(error)}`));
  return {
    warning: () => run(module.notificationAsync(ExpoHaptics.NotificationFeedbackType.Warning)),
    success: () => run(module.notificationAsync(ExpoHaptics.NotificationFeedbackType.Success)),
    light: () => run(module.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Light)),
  };
}
