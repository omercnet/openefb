// app.config.ts reads the build variant and the marketing version from the environment (fastlane beta_rn sets
// KANAF_VERSION from version.txt). Without them the config is the one every other build uses.
import type { ConfigContext } from 'expo/config';

function load(env: Record<string, string | undefined>) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  for (const k of Object.keys(env)) if (env[k] === undefined) delete process.env[k];
  try {
    let config: { version?: string; ios?: { bundleIdentifier?: string } } = {};
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs a synchronous load
      const make = require('../../app.config').default as (c: ConfigContext) => typeof config;
      config = make({ config: {} } as ConfigContext);
    });
    return config;
  } finally {
    process.env = saved;
  }
}

describe('app.config marketing version', () => {
  it('stays 1.0.0 without KANAF_VERSION', () => {
    expect(load({ KANAF_VERSION: undefined }).version).toBe('1.0.0');
  });

  it('takes KANAF_VERSION for the production identity', () => {
    const config = load({ KANAF_VERSION: '1.4.0', KANAF_VARIANT: 'production' });
    expect(config.version).toBe('1.4.0');
    expect(config.ios?.bundleIdentifier).toBe('io.omer.efb');
  });

  it('refuses a version Apple would reject', () => {
    expect(() => load({ KANAF_VERSION: 'v1.4.0-rc1' })).toThrow(/KANAF_VERSION/);
  });
});
