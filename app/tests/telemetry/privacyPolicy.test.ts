// PRIVACY.md is a public commitment (it is the privacy policy URL of the store listing, and it says it changes before the app
// sends anything new), so what it says about the usage counters is checked against the code that sends them.
import fs from 'node:fs';
import path from 'node:path';

import { TELEMETRY_SCHEMA } from '../../src/domain/telemetry/schema';

const REPO = path.join(__dirname, '..', '..', '..');

describe('PRIVACY.md', () => {
  const policy = fs.readFileSync(path.join(REPO, 'PRIVACY.md'), 'utf8');

  test.each(Object.keys(TELEMETRY_SCHEMA.events))('lists the event %s', (event) => {
    expect(policy).toContain(`\`${event}\``);
  });

  test('names the host the Worker is deployed to (the name in wrangler.toml, on the developer\u2019s workers.dev)', () => {
    const name = /^name = "([^"]+)"$/m.exec(
      fs.readFileSync(path.join(REPO, 'web/telemetry/wrangler.toml'), 'utf8'),
    )?.[1];
    expect(name).toBe('openefb-telemetry');
    expect(policy).toContain(`${name}.omerc.workers.dev`);
  });

  test('no longer promises what the rewrite does not do: TelemetryDeck, MetricKit crash reports, speech fallback to SFSpeechRecognizer', () => {
    expect(policy).not.toMatch(/TelemetryDeck|MetricKit|nom\.telemetrydeck\.com|SFSpeechRecognizer/);
  });

  test('says the counts carry no identifier, can be turned off, and that crash reports are not collected', () => {
    expect(policy).toMatch(/no user, device, installation or session identifier/);
    expect(policy).toContain('Settings > Privacy > Share anonymous usage data');
    expect(policy).toMatch(/does not collect crash or hang reports/);
  });
});
