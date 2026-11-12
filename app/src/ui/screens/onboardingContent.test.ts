// Parity of the onboarding copy with efb-212/Views/Onboarding/OnboardingView.swift (read in place; no Swift test covers it).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ONBOARDING_SUMMARY, PRIMARY_NAVIGATION } from '../../domain/disclaimers';
import { ONBOARDING_ACTION, ONBOARDING_ROWS, ONBOARDING_TITLE } from './onboardingContent';

const swift = readFileSync(join(__dirname, '../../../../efb-212/Views/Onboarding/OnboardingView.swift'), 'utf8');

/** An argument is a string literal or a dotted identifier (`Disclaimers.onboardingSummary`). */
const arg = String.raw`("(?:[^"\\]|\\.)*"|[\w.]+)`;
const unquote = (raw: string): string => (raw.startsWith('"') ? raw.slice(1, -1) : raw);

/** The `row(systemImage:, title:, text:, tint:)` calls in order. */
function swiftRows(): { image: string; title: string; text: string; tint: string | null }[] {
  const call = new RegExp(
    String.raw`\brow\(\s*systemImage: ${arg},\s*title: ${arg},\s*text: ${arg}(?:,\s*tint: ${arg})?\s*\)`,
    'g',
  );
  return [...swift.matchAll(call)].map((m) => ({
    image: unquote(m[1]),
    title: unquote(m[2]),
    text: unquote(m[3]),
    tint: m[4] === undefined ? null : unquote(m[4]),
  }));
}

describe('onboarding copy', () => {
  it('has the three rows of the Swift view, in order', () => {
    const rows = swiftRows();
    expect(rows.map((r) => r.image)).toEqual(['map.fill', 'icloud.slash', 'exclamationmark.shield.fill']);
    expect(ONBOARDING_ROWS).toHaveLength(rows.length);
  });

  it('the first two rows are verbatim', () => {
    const rows = swiftRows();
    for (const i of [0, 1]) {
      expect(ONBOARDING_ROWS[i].title).toBe(rows[i].title);
      expect(ONBOARDING_ROWS[i].text).toBe(rows[i].text);
    }
  });

  it('the third row is the primary-navigation disclaimer with its short form, in the caution tint', () => {
    const third = swiftRows()[2];
    expect(third.title).toBe('Disclaimers.primaryNavigation.title');
    expect(third.text).toBe('Disclaimers.onboardingSummary');
    expect(third.tint).toBe('Palette.caution');
    expect(ONBOARDING_ROWS[2]).toMatchObject({
      title: PRIMARY_NAVIGATION.title,
      text: ONBOARDING_SUMMARY,
      tone: 'caution',
    });
  });

  it('the other rows use the accent tint (the default of Swift row(tint:))', () => {
    expect(ONBOARDING_ROWS.slice(0, 2).map((r) => r.tone)).toEqual(['accent', 'accent']);
  });

  it('the title and the action are verbatim', () => {
    expect(swift).toContain(`Text(${JSON.stringify(ONBOARDING_TITLE)})`);
    expect(swift).toContain(`Text(${JSON.stringify(ONBOARDING_ACTION)})`);
  });
});
