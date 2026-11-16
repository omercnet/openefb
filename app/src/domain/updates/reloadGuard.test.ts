import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isRecordingActive, otaReloadAllowed } from './reloadGuard';

describe('OTA reload guard', () => {
  it('allows a reload only with no recording in any state', () => {
    expect(otaReloadAllowed(null)).toBe(true);
    expect(otaReloadAllowed({ kind: 'idle' })).toBe(true);
    for (const status of [
      { kind: 'countdown', remaining: 2 },
      { kind: 'recording' },
      { kind: 'paused' },
      { kind: 'stopping' },
    ] as const) {
      expect(isRecordingActive(status)).toBe(true);
      expect(otaReloadAllowed(status)).toBe(false);
    }
  });
});

// Updates apply on a cold start only: nothing but the OTA smoke screen may reload the running bundle.
describe('cold start only', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
    });

  it('reloadAsync is called only from the OTA smoke screen, which checks the guard first', () => {
    const callers = files('src')
      .filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'))
      .filter((f) => /\.reloadAsync\(/.test(readFileSync(f, 'utf8')));
    expect(callers.map((f) => f.replace(/\\/g, '/'))).toEqual(['src/ui/screens/OtaScreen.tsx']);
    expect(readFileSync(callers[0]!, 'utf8')).toContain('otaReloadAllowed');
  });

  it('the build checks for updates on load only, never mid-session', () => {
    const config = readFileSync('app.config.ts', 'utf8');
    expect(config).toMatch(/checkAutomatically: OTA_SMOKE \? 'NEVER' : 'ON_LOAD'/);
    expect(config).toContain('fallbackToCacheTimeout: 0');
  });
});
