// The privacy policy, PRIVACY.md, for the rewritten app (it replaced the Swift app's at cutover). This keeps what it says about
// the usage counters in step with the code that sends them, so it cannot drift from what the app does.
import fs from 'node:fs';
import path from 'node:path';

import { TELEMETRY_SCHEMA } from '../../src/domain/telemetry/schema';

const REPO = path.join(__dirname, '..', '..', '..');
const POLICY_FILE = 'PRIVACY.md';

// The two claims the owner confirms at cutover (the PR that swapped the policy lists them).
const HOST = 'openefb-telemetry.omerc.workers.dev';
const RETENTION = 'Cloudflare keeps them for three months';

const policy = fs.readFileSync(path.join(REPO, POLICY_FILE), 'utf8');
// The same text without line breaks, to find a sentence wherever the lines wrap.
const policyText = policy.replace(/\s+/g, ' ');

describe('the privacy policy for the rewritten app', () => {
  test.each(Object.keys(TELEMETRY_SCHEMA.events))('lists the event %s', (event) => {
    expect(policy).toContain(`\`${event}\``);
  });

  test('names the host the Worker is deployed to: its name in wrangler.toml, on the owner account at workers.dev', () => {
    const name = /^name = "([^"]+)"$/m.exec(
      fs.readFileSync(path.join(REPO, 'web/telemetry/wrangler.toml'), 'utf8'),
    )?.[1];
    expect(`${name}.omerc.workers.dev`).toBe(HOST);
    expect(policyText).toContain(HOST);
  });

  test('does not promise what the rewrite does not do: TelemetryDeck, MetricKit crash reports, speech fallback to SFSpeechRecognizer', () => {
    expect(policy).not.toMatch(/TelemetryDeck|MetricKit|nom\.telemetrydeck\.com|SFSpeechRecognizer/);
  });

  test('says the counts carry no identifier, can be turned off, and that crash reports are not collected', () => {
    expect(policy).toMatch(/no user, device, installation or session identifier/);
    expect(policy).toContain('Settings > Privacy > Share anonymous usage data');
    expect(policy).toMatch(/does not collect crash or hang reports/);
  });
});

describe('the policy makes the two owner-confirmed claims', () => {
  test.each([
    ['the host name', HOST],
    ['the retention', RETENTION],
  ])('says %s', (_name, claim) => {
    expect(policyText).toContain(claim);
  });
});

describe('the policy describes the rewritten app, not the Swift one', () => {
  test('no longer mentions SwiftData or iCloud sync, and is not a draft', () => {
    expect(policy).not.toMatch(/SwiftData|iCloud sync|DRAFT, not published/);
  });
});
