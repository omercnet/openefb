import { acknowledgeOnboarding, hasSeenOnboarding, markOnboardingSeen, ONBOARDING_SEEN_KEY } from './onboarding';
import { FakePreferences, type Preferences } from './ports/preferences';

describe('onboarding flag (@AppStorage("hasSeenOnboarding"))', () => {
  it('uses the Swift key', () => {
    expect(ONBOARDING_SEEN_KEY).toBe('hasSeenOnboarding');
  });

  it('is not seen on a fresh install, and seen once marked', async () => {
    const prefs = new FakePreferences();
    expect(await hasSeenOnboarding(prefs)).toBe(false);
    await markOnboardingSeen(prefs);
    expect(await hasSeenOnboarding(prefs)).toBe(true);
  });

  it('marking twice stays seen', async () => {
    const prefs = new FakePreferences();
    await markOnboardingSeen(prefs);
    await markOnboardingSeen(prefs);
    expect(await hasSeenOnboarding(prefs)).toBe(true);
  });

  it('an unreadable store shows onboarding again instead of failing (JS-only guard)', async () => {
    const broken: Preferences = {
      get: () => Promise.reject(new Error('storage unavailable')),
      set: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    };
    expect(await hasSeenOnboarding(broken)).toBe(false);
  });

  it('a failing write rejects so the caller can report it', async () => {
    const broken: Preferences = {
      get: () => Promise.resolve(null),
      set: () => Promise.reject(new Error('disk full')),
      remove: () => Promise.resolve(),
    };
    await expect(markOnboardingSeen(broken)).rejects.toThrow('disk full');
  });
});

describe('acknowledgeOnboarding ("I understand")', () => {
  it('records the flag and reports it saved', async () => {
    const prefs = new FakePreferences();
    expect(await acknowledgeOnboarding(prefs)).toEqual({ saved: true });
    expect(await hasSeenOnboarding(prefs)).toBe(true);
  });

  it('a failed write is reported, not thrown, so the user is not kept on the screen', async () => {
    const broken: Preferences = {
      get: () => Promise.resolve(null),
      set: () => Promise.reject(new Error('disk full')),
      remove: () => Promise.resolve(),
    };
    expect(await acknowledgeOnboarding(broken)).toEqual({ saved: false, error: 'disk full' });
  });
});
