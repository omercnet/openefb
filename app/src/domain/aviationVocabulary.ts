// Port of efb-212/Services/Recording/AviationVocabulary.swift (AviationVocabularyProcessor): regex corrections for what
// speech recognisers write when they hear radio phraseology, applied to every transcript result in the same order as
// Swift. Differences and preserved quirks: docs/port-notes/A3.md.

/**
 * Spoken digits, ICAO and common variants (Swift digitMap). The keys looked up are words the regexes below matched, so
 * names inherited from Object.prototype never reach these tables.
 */
const DIGITS: Readonly<Record<string, string | undefined>> = {
  zero: '0',
  one: '1',
  two: '2',
  to: '2',
  tree: '3',
  three: '3',
  four: '4',
  fower: '4',
  fife: '5',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  niner: '9',
  nine: '9',
};

/** Phonetic alphabet (Swift phoneticAlphabet). A Map: the ATIS and N-number patterns are built from its keys, in order. */
const LETTERS = new Map([
  ['alfa', 'A'],
  ['alpha', 'A'],
  ['bravo', 'B'],
  ['charlie', 'C'],
  ['delta', 'D'],
  ['echo', 'E'],
  ['foxtrot', 'F'],
  ['golf', 'G'],
  ['hotel', 'H'],
  ['india', 'I'],
  ['juliet', 'J'],
  ['kilo', 'K'],
  ['lima', 'L'],
  ['mike', 'M'],
  ['november', 'N'],
  ['oscar', 'O'],
  ['papa', 'P'],
  ['quebec', 'Q'],
  ['romeo', 'R'],
  ['sierra', 'S'],
  ['tango', 'T'],
  ['uniform', 'U'],
  ['victor', 'V'],
  ['whiskey', 'W'],
  ['xray', 'X'],
  ['x-ray', 'X'],
  ['yankee', 'Y'],
  ['zulu', 'Z'],
]);

/** Number words for altitudes (Swift numberWords; "hundred" and "thousand" are handled apart). A Map for the same reason. */
const NUMBERS = new Map([
  ['zero', 0],
  ['one', 1],
  ['two', 2],
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['six', 6],
  ['seven', 7],
  ['eight', 8],
  ['nine', 9],
  ['niner', 9],
  ['ten', 10],
  ['eleven', 11],
  ['twelve', 12],
  ['thirteen', 13],
  ['fourteen', 14],
  ['fifteen', 15],
  ['sixteen', 16],
  ['seventeen', 17],
  ['eighteen', 18],
  ['nineteen', 19],
  ['twenty', 20],
  ['thirty', 30],
  ['forty', 40],
  ['fifty', 50],
]);

const DIGIT_WORDS = 'zero|one|two|three|four|five|six|seven|eight|nine|niner';
const NUMBER_WORDS = [...NUMBERS.keys(), 'hundred', 'thousand'].join('|');
const LETTER_WORDS = [...LETTERS.keys()].filter((w) => w !== 'november').join('|');

const N_NUMBER = new RegExp(String.raw`november\s+((?:(?:${DIGIT_WORDS}|${LETTER_WORDS})\s*){1,6})`, 'gi');
const FLIGHT_LEVEL = new RegExp(String.raw`flight\s+level\s+((?:(?:${DIGIT_WORDS})\s*){2,3})`, 'gi');
const FREQUENCY = new RegExp(
  String.raw`((?:(?:${DIGIT_WORDS})\s+){2,3})point\s+((?:(?:${DIGIT_WORDS})\s*){1,3})`,
  'gi',
);
const SQUAWK = new RegExp(String.raw`squawk\s+((?:(?:${DIGIT_WORDS})\s*){4})`, 'gi');
const RUNWAY = new RegExp(String.raw`runway\s+((?:(?:${DIGIT_WORDS})\s*){1,2})\s*(left|right|center)?`, 'gi');
const ALTITUDE = new RegExp(String.raw`(maintain|altitude|descend|climb|at)\s+((?:(?:${NUMBER_WORDS})\s*)+)`, 'gi');
const HEADING = new RegExp(String.raw`heading\s+((?:(?:${DIGIT_WORDS})\s*){2,3})`, 'gi');
const ATIS = new RegExp(String.raw`(?:atis\s+)?information\s+(${[...LETTERS.keys()].join('|')})`, 'gi');

/** Swift CharacterSet.whitespaces: Unicode space separators and tab (not newlines). */
const EDGE_WHITESPACE =
  /^[\t \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]+|[\t \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]+$/g;

/** Swift `split(separator: " ")` then lowercased and trimmed, as every processor did before looking a word up. */
function words(text: string): string[] {
  return text
    .split(' ')
    .filter((word) => word !== '')
    .map((word) => word.toLowerCase().replace(EDGE_WHITESPACE, ''));
}

/** The digit each spoken digit word stands for; words that are not digits are skipped. */
function digitsOf(text: string): string {
  return words(text)
    .flatMap((word) => DIGITS[word] ?? [])
    .join('');
}

/** "four thousand five hundred" -> 4500 (Swift parseSpokenNumber). Unknown words count for nothing. */
function parseSpokenNumber(text: string): number {
  let total = 0;
  let current = 0;
  for (const word of words(text)) {
    if (word === 'hundred') {
      current = (current === 0 ? 1 : current) * 100;
    } else if (word === 'thousand') {
      current = (current === 0 ? 1 : current) * 1000;
      total += current;
      current = 0;
    } else {
      current += NUMBERS.get(word) ?? 0;
    }
  }
  return total + current;
}

const SIDES: Readonly<Record<string, string | undefined>> = { left: 'L', right: 'R', center: 'C' };

/** Corrects transcript text in Swift's order: N-numbers, flight levels, frequencies, squawk, runways, altitudes, headings, ATIS. */
export function processAviationVocabulary(text: string): string {
  return text
    .toLowerCase()
    .replace(N_NUMBER, (_match, tail: string) => {
      const letters = words(tail).flatMap((word) => DIGITS[word] ?? LETTERS.get(word) ?? []);
      return `N${letters.join('')}`;
    })
    .replace(FLIGHT_LEVEL, (_match, tail: string) => `FL${digitsOf(tail)}`)
    .replace(FREQUENCY, (_match, whole: string, decimal: string) => `${digitsOf(whole)}.${digitsOf(decimal)}`)
    .replace(SQUAWK, (_match, tail: string) => `Squawk ${digitsOf(tail)}`)
    .replace(
      RUNWAY,
      (_match, tail: string, side: string | undefined) =>
        `Runway ${digitsOf(tail)}${side === undefined ? '' : (SIDES[side.toLowerCase()] ?? '')}`,
    )
    .replace(ALTITUDE, (match, prefix: string, tail: string) => {
      const value = parseSpokenNumber(tail);
      // Swift formatted with the device locale; the vocabulary is English, so thousands always get commas.
      return value > 0 ? `${prefix} ${String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}` : match;
    })
    .replace(HEADING, (_match, tail: string) => `heading ${digitsOf(tail)}`)
    .replace(ATIS, (_match, letter: string) => `ATIS Information ${LETTERS.get(letter.toLowerCase())}`);
}

/**
 * Terms that bias a recogniser toward radio vocabulary (Swift aviationContextualStrings). Swift gave them to
 * SFSpeechRecognizer only; its SpeechAnalyzer path got just the region terms.
 */
export const AVIATION_CONTEXTUAL_STRINGS: readonly string[] = [
  'november',
  'niner',
  'squawk',
  'atis',
  'metar',
  'pirep',
  'runway',
  'taxiway',
  'cleared',
  'roger',
  'wilco',
  'unable',
  'approach',
  'departure',
  'tower',
  'ground',
  'center',
  'unicom',
  'altitude',
  'heading',
  'flight level',
  'maintain',
  'descend',
  'climb',
];
