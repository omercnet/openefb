// The privacy policy for the rewritten app is a draft, app/docs/privacy-rn-draft.md, until cutover: PRIVACY.md describes the Swift
// app that is live in the App Store, and the draft replaces it then (a release step the owner approves). Until then this keeps what
// the draft says about the usage counters in step with the code that sends them, so it cannot drift before it is published.
//
// At cutover: point POLICY_FILE at 'PRIVACY.md' and delete the "draft header" block below (the header goes with the draft file).
import fs from 'node:fs';
import path from 'node:path';

import { TELEMETRY_SCHEMA } from '../../src/domain/telemetry/schema';

const REPO = path.join(__dirname, '..', '..', '..');
const POLICY_FILE = 'app/docs/privacy-rn-draft.md';

// The two claims the owner confirms at cutover. The draft's header lists them; the policy makes them.
const HOST = 'openefb-telemetry.omerc.workers.dev';
const RETENTION = 'Cloudflare keeps them for three months';

const file = fs.readFileSync(path.join(REPO, POLICY_FILE), 'utf8');
const headingAt = file.search(/^# Kanaf privacy policy$/m);
// Everything above the policy heading is the draft header (notes for the owner, not policy text).
const header = file.slice(0, Math.max(headingAt, 0));
const policy = file.slice(Math.max(headingAt, 0));
// The same text without line breaks and blockquote marks, to find a sentence wherever the lines wrap.
const headerText = header.replace(/^> ?/gm, '').replace(/\s+/g, ' ');
const policyText = policy.replace(/\s+/g, ' ');

describe('the draft policy for the rewritten app', () => {
  test('is a header for the owner followed by the policy, which starts at its heading', () => {
    expect(headingAt).toBeGreaterThan(0);
  });

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

  test('no longer promises what the rewrite does not do: TelemetryDeck, MetricKit crash reports, speech fallback to SFSpeechRecognizer', () => {
    expect(policy).not.toMatch(/TelemetryDeck|MetricKit|nom\.telemetrydeck\.com|SFSpeechRecognizer/);
  });

  test('says the counts carry no identifier, can be turned off, and that crash reports are not collected', () => {
    expect(policy).toMatch(/no user, device, installation or session identifier/);
    expect(policy).toContain('Settings > Privacy > Share anonymous usage data');
    expect(policy).toMatch(/does not collect crash or hang reports/);
  });
});

describe('the draft header', () => {
  test.each([
    ['the host name', HOST],
    ['the retention', RETENTION],
  ])('lists %s among the claims to confirm, in the words the policy uses', (_name, claim) => {
    expect(headerText).toContain(claim);
    expect(policyText).toContain(claim);
  });
});
