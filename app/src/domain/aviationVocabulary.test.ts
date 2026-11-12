// Port of efb-212Tests/ServiceTests/AviationVocabularyTests.swift (11 cases, same names, inputs and assertions), then
// the exact outputs of the Swift implementation, including its quirks (docs/port-notes/A3.md).
import { AVIATION_CONTEXTUAL_STRINGS, processAviationVocabulary as process } from './aviationVocabulary';

describe('AviationVocabulary Tests', () => {
  test('nNumberConversion', () => {
    expect(process('november seven three two papa')).toContain('N732P');
  });

  test('ninerToNine', () => {
    expect(process('squawk one two zero niner')).toContain('1209');
  });

  test('frequencyFormat', () => {
    expect(process('one two three point four five')).toContain('123.45');
  });

  test('flightLevelFormat', () => {
    expect(process('flight level three five zero')).toContain('FL350');
  });

  test('runwayFormat', () => {
    expect(process('runway two seven left')).toContain('Runway 27L');
  });

  test('squawkCode', () => {
    expect(process('squawk one two zero zero')).toContain('1200');
  });

  test('altitudeFormat', () => {
    const result = process('maintain four thousand five hundred');
    expect(result.includes('4,500') || result.includes('4500')).toBe(true);
  });

  test('headingFormat', () => {
    expect(process('heading three six zero')).toContain('360');
  });

  test('atisLetter', () => {
    const result = process('atis information bravo');
    expect(result.includes('B') || result.includes('Bravo')).toBe(true);
  });

  test('noChangeForNormalText', () => {
    expect(process('hello world')).toBe('hello world');
  });

  test('multipleCorrections', () => {
    const result = process('november seven three two papa contact one two three point four five');
    expect(result).toContain('N732P');
    expect(result).toContain('123.45');
  });
});

describe('exact output', () => {
  test.each([
    ['november seven three two papa', 'N732P'],
    ['november alpha bravo', 'NAB'],
    ['november one two x-ray', 'N12X'],
    ['squawk seven seven zero zero', 'Squawk 7700'],
    ['one two three point four five', '123.45'],
    ['one one eight point seven', '118.7'],
    ['flight level three five zero', 'FL350'],
    ['flight level nine zero', 'FL90'],
    ['runway two seven left', 'Runway 27L'],
    ['runway one zero right', 'Runway 10R'],
    ['runway three six center', 'Runway 36C'],
    ['runway one eight', 'Runway 18'],
    ['maintain four thousand five hundred', 'maintain 4,500'],
    ['maintain seven thousand', 'maintain 7,000'],
    ['climb twelve thousand', 'climb 12,000'],
    ['descend one thousand five hundred', 'descend 1,500'],
    ['altitude two thousand', 'altitude 2,000'],
    ['maintain hundred', 'maintain 100'],
    ['heading three six zero', 'heading 360'],
    ['heading zero one zero', 'heading 010'],
    ['one two niner point five', '129.5'],
    ['atis information bravo', 'ATIS Information B'],
    ['information charlie', 'ATIS Information C'],
    ['information x-ray', 'ATIS Information X'],
    ['information whiskey', 'ATIS Information W'],
  ])('%s -> %s', (input, expected) => {
    expect(process(input)).toBe(expected);
  });

  test('text is lower-cased first, so capitals in the recogniser output are lost (Swift lowercased() before anything)', () => {
    expect(process('November Seven Three Two Papa')).toBe('N732P');
    expect(process('Cleared To Land')).toBe('cleared to land');
  });

  test('every correction in a longer phrase applies, in the same pass', () => {
    // Flight levels convert first, so the squawk group swallows the space before FL350; "left" ends the runway
    // pattern without whitespace, so the space after Runway 27L stays.
    expect(process('runway two seven left squawk one two zero zero flight level three five zero')).toBe(
      'Runway 27L Squawk 1200FL350',
    );
  });
});

describe('quirks kept from Swift', () => {
  test('a converted phrase swallows the whitespace after it (the regex group ends in \\s*)', () => {
    expect(process('squawk one two zero zero and ident')).toBe('Squawk 1200and ident');
    expect(process('november seven three two papa contact tower')).toBe('N732Pcontact tower');
    expect(process('heading three six zero then descend')).toBe('heading 360then descend');
  });

  test('an N-number takes at most six words after november; the rest stays as words', () => {
    expect(process('november one two three four five six seven')).toBe('N123456seven');
  });

  // (The Swift ordering bugs that used to be pinned here, "niner" as 9 plus a stray "r" and "fourteen" as "4teen", are fixed:
  // owner-approved deviation Q8, 2026-11-12. See "number words that start with a shorter number word" below.)

  test('"at" matches inside other words, so a number word after one is converted', () => {
    expect(process('that five')).toBe('that 5');
  });

  test.each([
    ['one digit word is too few for a flight level', 'flight level one'],
    ['one whole digit is too few for a frequency', 'one point five'],
    ['a squawk needs exactly four digits', 'squawk one two zero'],
    ['"to", "tree", "fife" and "fower" are in the digit table but not in the patterns', 'squawk one two to zero'],
    ['november alone is not an N-number', 'november'],
    ['a heading needs two or three digits', 'heading three'],
    ['a number word with nothing after the prefix', 'maintain'],
  ])('%s', (_name, input) => {
    expect(process(input)).toBe(input);
  });

  test('words glued together without a space still match, but their digits are lost', () => {
    expect(process('flight level onetwo')).toBe('FL');
  });
});

describe('number words that start with a shorter number word (Q8: fixed, Swift gives "4teen" and "9r")', () => {
  test.each([
    ['ten', '10'],
    ['eleven', '11'],
    ['twelve', '12'],
    ['thirteen', '13'],
    ['fourteen', '14'],
    ['fifteen', '15'],
    ['sixteen', '16'],
    ['seventeen', '17'],
    ['eighteen', '18'],
    ['nineteen', '19'],
  ])('altitude: climb %s thousand reads as %s thousand in digits', (word, digits) => {
    expect(process(`climb ${word} thousand`)).toBe(`climb ${digits},000`);
  });

  test.each([
    ['descend sixteen hundred', 'descend 1,600'],
    ['at seventeen thousand', 'at 17,000'],
    ['maintain nineteen thousand five hundred', 'maintain 19,500'],
    ['maintain eighteen thousand', 'maintain 18,000'],
    ['maintain niner thousand', 'maintain 9,000'],
    ['maintain niner thousand five hundred', 'maintain 9,500'],
    ['climb four thousand', 'climb 4,000'],
    ['climb nine thousand', 'climb 9,000'],
  ])('altitude: %s -> %s', (input, expected) => {
    expect(process(input)).toBe(expected);
  });

  test.each([
    ['squawk one two zero niner', 'Squawk 1209'],
    ['squawk niner niner niner niner', 'Squawk 9999'],
    ['squawk niner one two seven', 'Squawk 9127'],
    ['squawk seven seven zero zero', 'Squawk 7700'],
  ])('squawk: %s -> %s', (input, expected) => {
    expect(process(input)).toBe(expected);
  });

  test.each([
    ['one two niner point five', '129.5'],
    ['one one eight point niner', '118.9'],
    ['one two one point niner five', '121.95'],
    ['one two three point four', '123.4'],
  ])('frequency: %s -> %s', (input, expected) => {
    expect(process(input)).toBe(expected);
  });

  test.each([
    ['runway niner', 'Runway 9'],
    ['runway one niner left', 'Runway 19L'],
    ['heading zero niner zero', 'heading 090'],
    ['flight level two niner zero', 'FL290'],
    ['november seven three two niner', 'N7329'],
    ['november niner two papa', 'N92P'],
  ])('runway, heading, flight level, N-number: %s -> %s', (input, expected) => {
    expect(process(input)).toBe(expected);
  });

  test('"nine" still reads as 9, and a word that merely starts with a number word is not touched', () => {
    expect(process('squawk one two zero nine')).toBe('Squawk 1209');
    expect(process('runway nine')).toBe('Runway 9');
    expect(process('tower')).toBe('tower');
  });

  test('keeps lower-casing and spacing as Swift does', () => {
    expect(process('SQUAWK One Two Zero NINER')).toBe('Squawk 1209');
    expect(process('Cleared TO land')).toBe('cleared to land');
  });
});

describe('AVIATION_CONTEXTUAL_STRINGS', () => {
  test('are the 24 terms Swift gave SFSpeechRecognizer', () => {
    expect(AVIATION_CONTEXTUAL_STRINGS).toHaveLength(24);
    expect(AVIATION_CONTEXTUAL_STRINGS).toEqual(
      expect.arrayContaining(['november', 'niner', 'squawk', 'flight level']),
    );
  });
});
