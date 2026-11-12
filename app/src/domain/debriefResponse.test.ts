// The model output arrives from the native module as JSON text. Swift decoded it with FlightDebrief(GeneratedContent), which
// throws on a mismatch; this checks the same shape in TypeScript (no Swift tests exist for it).
import { parseFlightDebrief, parsePartialFlightDebrief } from './debriefResponse';
import { DebriefError } from './ports/debriefModel';

const VALID = {
  narrativeSummary: 'A smooth local flight.',
  phaseObservations: [
    { phase: 'takeoff', observations: ['Rotated at 55 knots.'], executedWell: true },
    { phase: 'approach', observations: [], executedWell: false },
  ],
  improvements: ['Stabilize the approach earlier.'],
  overallRating: 4,
};

const json = (value: unknown): string => JSON.stringify(value);
const without = (key: string): Record<string, unknown> => {
  const copy: Record<string, unknown> = { ...VALID };
  delete copy[key];
  return copy;
};

describe('parseFlightDebrief', () => {
  test('reads a complete debrief', () => {
    expect(parseFlightDebrief(json(VALID))).toEqual(VALID);
  });

  test('keeps empty lists and an empty summary (the model may have nothing to add)', () => {
    const quiet = { narrativeSummary: '', phaseObservations: [], improvements: [], overallRating: 1 };
    expect(parseFlightDebrief(json(quiet))).toEqual(quiet);
  });

  test('drops fields it does not know, at both levels', () => {
    const noisy = {
      ...VALID,
      extra: 1,
      phaseObservations: [{ phase: 'cruise', observations: ['Steady.'], executedWell: true, note: 'x' }],
    };
    expect(parseFlightDebrief(json(noisy))).toEqual({
      ...VALID,
      phaseObservations: [{ phase: 'cruise', observations: ['Steady.'], executedWell: true }],
    });
  });

  test.each([1, 2, 3, 4, 5])('accepts a rating of %i', (overallRating) => {
    expect(parseFlightDebrief(json({ ...VALID, overallRating })).overallRating).toBe(overallRating);
  });

  test.each([
    ['narrativeSummary missing', without('narrativeSummary')],
    ['phaseObservations missing', without('phaseObservations')],
    ['improvements missing', without('improvements')],
    ['overallRating missing', without('overallRating')],
    ['narrativeSummary a number', { ...VALID, narrativeSummary: 4 }],
    ['phaseObservations an object', { ...VALID, phaseObservations: {} }],
    ['improvements with a number', { ...VALID, improvements: ['ok', 3] }],
    ['an observation without a phase', { ...VALID, phaseObservations: [{ observations: [], executedWell: true }] }],
    [
      'an observation phase that is a number',
      { ...VALID, phaseObservations: [{ phase: 1, observations: [], executedWell: true }] },
    ],
    [
      'an observation list with a number',
      { ...VALID, phaseObservations: [{ phase: 'x', observations: [1], executedWell: true }] },
    ],
    ['executedWell as text', { ...VALID, phaseObservations: [{ phase: 'x', observations: [], executedWell: 'yes' }] }],
    ['an observation that is null', { ...VALID, phaseObservations: [null] }],
    ['an observation that is a string', { ...VALID, phaseObservations: ['takeoff'] }],
    ['rating 0', { ...VALID, overallRating: 0 }],
    ['rating 6', { ...VALID, overallRating: 6 }],
    ['rating 3.5', { ...VALID, overallRating: 3.5 }],
    ['rating as text', { ...VALID, overallRating: '4' }],
    ['rating null', { ...VALID, overallRating: null }],
  ])('rejects %s', (_name, value) => {
    expect(() => parseFlightDebrief(json(value))).toThrow(DebriefError);
  });

  test.each([
    ['null', 'null'],
    ['a list', '[]'],
    ['a string', '"a debrief"'],
    ['a number', '5'],
    ['empty text', ''],
    ['text that is not JSON', 'Here is your debrief:'],
    ['JSON cut off mid-way', '{"narrativeSummary": "A smo'],
  ])('rejects %s', (_name, text) => {
    expect(() => parseFlightDebrief(text)).toThrow(DebriefError);
  });

  test('the error is the malformed-response kind with a message for the pilot', () => {
    let caught: unknown;
    try {
      parseFlightDebrief('{}');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DebriefError);
    expect((caught as DebriefError).kind).toBe('malformedResponse');
    expect((caught as DebriefError).message).toBe('The debrief came back in a form the app could not read. Try again.');
  });
});

describe('parsePartialFlightDebrief', () => {
  test('reads whatever has arrived', () => {
    expect(parsePartialFlightDebrief(json({ narrativeSummary: 'A smooth' }))).toEqual({ narrativeSummary: 'A smooth' });
    expect(parsePartialFlightDebrief(json(VALID))).toEqual(VALID);
    expect(parsePartialFlightDebrief('{}')).toEqual({});
  });

  test('keeps an observation that is only partly there', () => {
    const partial = { phaseObservations: [{ phase: 'takeoff' }, { phase: 'cruise', observations: ['Steady'] }, {}] };
    expect(parsePartialFlightDebrief(json(partial))).toEqual({
      phaseObservations: [{ phase: 'takeoff' }, { phase: 'cruise', observations: ['Steady'] }, {}],
    });
  });

  test('skips fields of the wrong type instead of failing', () => {
    const odd = {
      narrativeSummary: 3,
      phaseObservations: [{ phase: 7, observations: ['ok', 2], executedWell: 'no' }, 'x', null],
      improvements: ['fine', 4, 'also fine'],
      overallRating: '5',
    };
    expect(parsePartialFlightDebrief(json(odd))).toEqual({
      phaseObservations: [{ observations: ['ok'] }],
      improvements: ['fine', 'also fine'],
    });
  });

  test('a rating outside 1 to 5 or not a whole number is skipped while it streams', () => {
    expect(parsePartialFlightDebrief(json({ overallRating: 9 }))).toEqual({});
    expect(parsePartialFlightDebrief(json({ overallRating: 2.5 }))).toEqual({});
    expect(parsePartialFlightDebrief(json({ overallRating: 3 }))).toEqual({ overallRating: 3 });
  });

  test.each([
    ['null', 'null'],
    ['a list', '[1]'],
    ['a string', '"x"'],
    ['empty text', ''],
    ['text that is not JSON', 'partial'],
    ['JSON cut off mid-way', '{"narrativeSummary": "A smo'],
  ])('returns null for %s, so a snapshot that cannot be read is skipped', (_name, text) => {
    expect(parsePartialFlightDebrief(text)).toBeNull();
  });
});
