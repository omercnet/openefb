// Port of efb-212/Services/Debrief/TranscriptTextMatcher.swift: finds Israel reporting points in transcript text,
// Hebrew or English. Matching is on normalised text: niqqud and cantillation removed, final letters folded to their
// medial forms, punctuation (incl. maqaf) turned into spaces, Latin letters lowercased.

import type { IsraelReportingPoint } from './types';

/** Hebrew final letters -> medial forms (ך ם ן ף ץ -> כ מ נ פ צ). */
const finalLetters: Record<string, string> = {
  '\u05DA': '\u05DB',
  '\u05DD': '\u05DE',
  '\u05DF': '\u05E0',
  '\u05E3': '\u05E4',
  '\u05E5': '\u05E6',
};

/** Swift: `isAlphabetic || numericType != nil`. */
const letterOrNumber = /^[\p{Alphabetic}\p{N}]$/u;

/** Lowercased, niqqud-free, final-letter-folded text with every non-letter/digit run as one space. */
export function normalize(text: string): string {
  let out = '';
  let lastWasSpace = true;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    // Hebrew points and cantillation: U+0591...U+05C7 (U+05BE maqaf is punctuation, handled below).
    if (code >= 0x0591 && code <= 0x05c7 && code !== 0x05be) continue;
    if (letterOrNumber.test(ch)) {
      const lowered = ch.toLowerCase();
      out += finalLetters[lowered] ?? lowered;
      lastWasSpace = false;
    } else if (!lastWasSpace) {
      out += ' ';
      lastWasSpace = true;
    }
  }
  return out.trim();
}

/** True when `text` names the point: its code, English name or Hebrew name, as whole words. Aerodrome ICAO codes
 * ("LLHZ") count too. */
export function mentions(
  point: Pick<IsraelReportingPoint, 'code' | 'nameEnglish' | 'nameHebrew'>,
  text: string,
): boolean {
  const haystack = ' ' + normalize(text) + ' ';
  const needles = [point.code, point.nameEnglish, point.nameHebrew].filter((n): n is string => n !== null);
  return needles.some((needle) => {
    const normalized = normalize(needle);
    return normalized !== '' && haystack.includes(' ' + normalized + ' ');
  });
}

/** Spoken forms to bias speech recognition towards: English and Hebrew names of the points, once each, no
 * aerodromes. */
export function vocabulary(points: readonly IsraelReportingPoint[]): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const point of points) {
    if (point.kind === 'arp') continue;
    for (const term of [point.nameEnglish, point.nameHebrew]) {
      if (term === null || seen.has(term)) continue;
      seen.add(term);
      terms.push(term);
    }
  }
  return terms;
}
