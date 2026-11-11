// The onboarding gate (efb_212App.swift `@AppStorage("hasSeenOnboarding")`, OnboardingView "I understand"). The screen
// and its copy are in ui/screens; this is the persisted flag, so the app shell can decide whether to show it at launch.
import { describeError } from './describeError';
import { readBool, writeBool, type Preferences } from './ports/preferences';

export const ONBOARDING_SEEN_KEY = 'hasSeenOnboarding';

/** False on a fresh install. An unreadable store also reads false: showing the disclaimers again is the safe side. */
export async function hasSeenOnboarding(prefs: Preferences): Promise<boolean> {
  try {
    return await readBool(prefs, ONBOARDING_SEEN_KEY, false);
  } catch {
    return false;
  }
}

/** Rejects when the flag cannot be written, so the caller can report it (the user is not kept on the screen). */
export const markOnboardingSeen = (prefs: Preferences): Promise<void> => writeBool(prefs, ONBOARDING_SEEN_KEY, true);

export type OnboardingAcknowledgement = { saved: true } | { saved: false; error: string };

/** "I understand": the user moves on either way; a failed write is returned so the shell can say it will show again. */
export async function acknowledgeOnboarding(prefs: Preferences): Promise<OnboardingAcknowledgement> {
  try {
    await markOnboardingSeen(prefs);
    return { saved: true };
  } catch (error) {
    return { saved: false, error: describeError(error) };
  }
}
