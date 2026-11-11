// Q1: a screen is in the fidelity gate only if five files agree. Nothing else connects them, and a screen missing from one
// of them is silently not gated (or the whole gate fails late, on a runner): its route, the iOS launch list in
// src/app/index.tsx, both capture scripts, its floors and its SwiftUI reference. See "UI data and fidelity screens" in
// README.md.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const words = (list: string) => list.trim().split(/\s+/);

type Floor = { min: number; interim?: number; reason?: string; metric?: string };
const thresholds = JSON.parse(read('scripts/fidelity-thresholds.json')) as {
  ios: Record<string, Floor>;
  android: Record<string, Floor>;
};

/** The screens the capture scripts launch: the iOS loop and the Android default list. */
const iosCaptured = words(/for screen in ([^;]+); do/.exec(read('scripts/ios-capture.sh'))?.[1] ?? '');
const androidCaptured = words(/SCREENS=\$\{SCREENS:-([^}]*)\}/.exec(read('scripts/android-capture.sh'))?.[1] ?? '');
/** Screens launched by `-KanafScreen <name>` (everything but the map, which is the root route itself). */
const launchScreens = [
  ...(/LAUNCH_SCREENS = \[([^\]]*)\]/.exec(read('src/app/index.tsx'))?.[1] ?? '').matchAll(/'([^']+)'/g),
].map((m) => m[1]);
/** compare.mjs REFERENCE_FOR: the screens whose reference is not reference/ipad-<name>.png. */
const referenceNames = Object.fromEntries(
  [...(/REFERENCE_FOR = \{([^}]*)\}/.exec(read('scripts/compare.mjs'))?.[1] ?? '').matchAll(/(\w+): '([^']+)'/g)].map(
    (m) => [m[1], m[2]],
  ),
);
const referenceFile = (screen: string) => `reference/${referenceNames[screen] ?? `ipad-${screen}.png`}`;
/** Captured for another reason than the gate (the native sheet probe). */
const NOT_GATED = ['sheet'];

describe('fidelity gate registration', () => {
  const screens = Object.keys(thresholds.ios);

  it('reads the lists it checks', () => {
    expect(screens.length).toBeGreaterThan(3);
    expect(iosCaptured).toContain('map');
    expect(androidCaptured).toContain('map');
    expect(launchScreens).toContain('airport');
    expect(referenceNames).toMatchObject({ map: 'ipad-map-day.png' });
  });

  it('gates the same screens on iOS and Android', () => {
    expect(Object.keys(thresholds.android).sort()).toEqual([...screens].sort());
  });

  it.each(screens)('%s has a route, a launch entry, both captures and a reference', (screen) => {
    expect(existsSync(join(root, `src/app/${screen}.tsx`))).toBe(true);
    if (screen !== 'map') expect(launchScreens).toContain(screen);
    expect(iosCaptured).toContain(screen);
    expect(androidCaptured).toContain(screen);
    expect(existsSync(join(root, referenceFile(screen)))).toBe(true);
  });

  it('gates everything it captures, except the sheet probe', () => {
    const ungated = [...new Set([...iosCaptured, ...androidCaptured])].filter(
      (s) => !NOT_GATED.includes(s) && !screens.includes(s),
    );
    expect(ungated).toEqual([]);
  });

  it('a launch entry has a route', () => {
    const missing = launchScreens.filter((s) => !existsSync(join(root, `src/app/${s}.tsx`)));
    expect(missing).toEqual([]);
  });

  it.each(['ios', 'android'] as const)(
    '%s floors are sane: an interim is below its target and says why',
    (platform) => {
      for (const [screen, floor] of Object.entries(thresholds[platform])) {
        expect([screen, floor.min > 0 && floor.min <= 1]).toEqual([screen, true]);
        if (floor.interim !== undefined) {
          expect([screen, floor.interim < floor.min, Boolean(floor.reason)]).toEqual([screen, true, true]);
        }
        if (floor.metric !== undefined) expect(['strip', 'frame']).toContain(floor.metric);
      }
    },
  );
});
