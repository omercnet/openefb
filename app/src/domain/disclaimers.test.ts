// Parity of disclaimers.ts with efb-212/Core/Disclaimers.swift (read in place, Swift stays until cutover). No Swift test
// covers Disclaimers, so the Swift source is the oracle for the verbatim PRD.md section 12 text.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DISCLAIMERS, ONBOARDING_SUMMARY, PRIMARY_NAVIGATION } from './disclaimers';

const swift = readFileSync(join(__dirname, '../../../efb-212/Core/Disclaimers.swift'), 'utf8');
const literal = String.raw`"((?:[^"\\]|\\.)*)"`;

function swiftItem(name: string): { title: string; text: string } {
  const m = new RegExp(`static let ${name} = Item\\(\\s*title: ${literal},\\s*text: ${literal}\\s*\\)`).exec(swift);
  if (!m) throw new Error(`Item ${name} not found in Disclaimers.swift`);
  return { title: m[1], text: m[2] };
}

describe('Disclaimers parity', () => {
  it('lists the five disclaimers in the Swift order, verbatim', () => {
    const order = /static let all: \[Item\] = \[([^\]]*)\]/
      .exec(swift)?.[1]
      .split(',')
      .map((s) => s.trim());
    expect(order).toEqual(['primaryNavigation', 'dataCurrency', 'weather', 'gps', 'notFAAApproved']);
    expect(DISCLAIMERS.map(({ title, text }) => ({ title, text }))).toEqual((order ?? []).map(swiftItem));
  });

  it('onboardingSummary is verbatim', () => {
    const m = new RegExp(`static let onboardingSummary =\\s*${literal}`).exec(swift);
    expect(ONBOARDING_SUMMARY).toBe(m?.[1]);
  });

  it('primaryNavigation is the first item (the onboarding page and Settings both show it)', () => {
    expect(PRIMARY_NAVIGATION).toBe(DISCLAIMERS[0]);
    expect(PRIMARY_NAVIGATION.title).toBe('Not for primary navigation');
  });

  it('ids are the titles (Swift Item.id), and unique', () => {
    const ids = DISCLAIMERS.map((d) => d.id);
    expect(ids).toEqual(DISCLAIMERS.map((d) => d.title));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
