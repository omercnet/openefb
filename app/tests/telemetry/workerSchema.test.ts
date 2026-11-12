// The vocabulary of the usage counters exists twice: in the app (src/domain/telemetry/schema.ts) and in the Worker that enforces
// it (web/telemetry/src/schema.json). The Worker's own tests import the app's schema too; this is the check in the app's CI.
import fs from 'node:fs';
import path from 'node:path';

import { TELEMETRY_SCHEMA } from '../../src/domain/telemetry/schema';

const REPO = path.join(__dirname, '..', '..', '..');

describe('the usage counter schema', () => {
  test('is the one the Worker enforces (web/telemetry/src/schema.json), field for field', () => {
    expect(TELEMETRY_SCHEMA).toEqual(
      JSON.parse(fs.readFileSync(path.join(REPO, 'web/telemetry/src/schema.json'), 'utf8')),
    );
  });
});
