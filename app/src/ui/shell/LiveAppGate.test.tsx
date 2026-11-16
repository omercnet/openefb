import { act } from 'react';
import { render } from '../../../tests/support/ui';
import { FakePreferences } from '../../domain/ports/preferences';
import { LiveAppGate } from './LiveAppGate';
import type { AppRuntime } from './runtime';

const order: string[] = [];
let resolveRuntime: (r: AppRuntime) => void = () => undefined;
let finishOnboarding: (() => void) | null = null;

jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('./runtime', () => ({
  getRuntime: () => new Promise((resolve) => (resolveRuntime = resolve)),
}));
jest.mock('./resetSlices', () => ({
  resetLiveSlices: (region: string) => void order.push(`reset:${region}`),
}));
let liveProps: { runtime: AppRuntime; onRegionChange?: (r: 'us' | 'israel') => void } | null = null;
jest.mock('./LiveApp', () => ({
  LiveApp: (props: typeof liveProps) => {
    liveProps = props;
    order.push('mount');
    return null;
  },
}));
jest.mock('../screens/OnboardingScreen', () => ({
  OnboardingScreen: ({ onDone }: { onDone: (r: { saved: true }) => void }) => {
    order.push('onboarding');
    finishOnboarding = () => onDone({ saved: true });
    return null;
  },
}));

const runtimeWith = (prefs: Record<string, string>) =>
  ({
    started: { region: 'israel' },
    preferences: new FakePreferences(prefs),
    layerSettings: {},
  }) as unknown as AppRuntime;

beforeEach(() => {
  order.length = 0;
  finishOnboarding = null;
});

describe('LiveAppGate', () => {
  it('shows the launch screen, then resets the slices with the restored region before mounting the live app', async () => {
    const view = await render(<LiveAppGate />);
    expect(view.byTestId('launchScreen')).toBeTruthy();
    expect(order).toEqual([]);
    await act(async () => resolveRuntime(runtimeWith({ hasSeenOnboarding: 'true' })));
    expect(order).toEqual(['reset:israel', 'mount']);
  });

  it('a fresh install shows the onboarding first, and the live app only after "I understand"', async () => {
    await render(<LiveAppGate />);
    await act(async () => resolveRuntime(runtimeWith({})));
    expect(order).toEqual(['reset:israel', 'onboarding']);
    await act(async () => finishOnboarding!());
    expect(order.at(-1)).toBe('mount');
  });

  it('Settings > Region starts the live app again on the new region, from the launch state', async () => {
    await render(<LiveAppGate />);
    await act(async () => resolveRuntime(runtimeWith({ hasSeenOnboarding: 'true' })));
    order.length = 0;
    expect(liveProps!.runtime.started.region).toBe('israel');
    await act(async () => liveProps!.onRegionChange!('us'));
    expect(order).toEqual(['reset:us', 'mount']); // reset first, then a fresh mount (a new key)
    expect(liveProps!.runtime.started.region).toBe('us');
    order.length = 0;
    await act(async () => liveProps!.onRegionChange!('us')); // no change, nothing restarts
    expect(order).toEqual([]);
  });
});
