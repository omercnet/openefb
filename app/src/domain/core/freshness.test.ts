import {
  ageText,
  DATA_PRODUCTS,
  evaluateFreshness,
  evaluateOverlayStaleness,
  freshnessRank,
  productDisplayName,
  type DataFreshness,
  type DataProduct,
} from './freshness';

const NOW = 1_793_332_020_000;
const MIN = 60_000;
const DAY = 86_400_000;

const age = (p: DataProduct, minutes: number): DataFreshness =>
  evaluateFreshness(p, { observed: NOW - minutes * MIN, now: NOW });
const edge = (p: DataProduct, minutes: number, validInMinutes?: number): DataFreshness =>
  evaluateFreshness(p, {
    observed: NOW - minutes * MIN,
    validUntil: validInMinutes === undefined ? undefined : NOW + validInMinutes * MIN,
    now: NOW,
  });
const chart = (daysLeft: number): DataFreshness =>
  evaluateFreshness('chartCycle', { validUntil: NOW + daysLeft * DAY, now: NOW });

describe('Data Freshness', () => {
  it.each([
    ['metar', 74, 'fresh'],
    ['metar', 75, 'old'],
    ['metar', 179, 'old'],
    ['metar', 180, 'expired'],
    ['pirep', 59, 'fresh'],
    ['pirep', 60, 'old'],
    ['pirep', 120, 'expired'],
    ['notam', 59, 'fresh'],
    ['notam', 60, 'old'],
    ['notam', 360, 'expired'],
    ['airmetSigmet', 29, 'fresh'],
    ['airmetSigmet', 30, 'old'],
    ['airmetSigmet', 120, 'expired'],
    ['tfr', 29, 'fresh'],
    ['tfr', 30, 'old'],
    ['tfr', 119, 'old'],
    ['tfr', 120, 'unsafe'],
  ] as const)('%s at %i min is %s', (p, minutes, level) => {
    expect(age(p, minutes).level).toBe(level);
  });

  it('onlyTFRIsRed', () => {
    for (const p of DATA_PRODUCTS.filter((x) => x !== 'tfr')) {
      expect(freshnessRank(age(p, 100_000).level)).toBeLessThan(freshnessRank('unsafe'));
    }
  });

  it('windsAloftWindow', () => {
    const start = NOW - 3600_000;
    const end = NOW + 3600_000;
    expect(evaluateFreshness('windsAloft', { validFrom: start, validUntil: end, now: NOW }).level).toBe('fresh');
    expect(evaluateFreshness('windsAloft', { validFrom: start, validUntil: NOW - 1, now: NOW }).level).toBe('expired');
    const future = NOW + 1800_000;
    expect(evaluateFreshness('windsAloft', { validFrom: future, validUntil: future + 3600_000, now: NOW }).text).toBe(
      'NOT YET VALID',
    );
  });

  it('windsAloftUnknown', () => {
    expect(evaluateFreshness('windsAloft', { now: NOW })).toEqual({
      product: 'windsAloft',
      level: 'unknown',
      text: 'N/A',
    });
  });

  it('chartCycleWindow', () => {
    expect(chart(8).level).toBe('fresh');
    expect(chart(7).level).toBe('old');
    expect(chart(3).text).toBe('EXPIRES 3d');
    expect(chart(-0.1).level).toBe('expired');
    expect(chart(-30).level).not.toBe('unsafe');
  });

  it('tafValidPeriod', () => {
    const issued = NOW - 5 * 3600_000;
    expect(evaluateFreshness('taf', { observed: issued, validUntil: NOW + 3600_000, now: NOW }).level).toBe('fresh');
    expect(evaluateFreshness('taf', { observed: issued, validUntil: NOW - 60_000, now: NOW }).level).toBe('expired');
  });

  it('missingTimestamp', () => {
    const r = evaluateFreshness('metar', { observed: null, now: NOW });
    expect([r.level, r.text]).toEqual(['unknown', 'N/A']);
  });

  it('futureObservation', () => {
    const r = evaluateFreshness('metar', { observed: NOW + 300_000, now: NOW });
    expect([r.level, r.text]).toEqual(['fresh', '<1 min']);
  });

  it('ageText', () => {
    expect(ageText(30)).toBe('<1 min');
    expect(ageText(15 * 60)).toBe('15 min');
    expect(ageText(60 * 60)).toBe('1h');
    expect(ageText(90 * 60)).toBe('1h 30m');
    expect(age('metar', 80).text).toBe('OLD 1h 20m');
  });
});

describe('Data Freshness edge characterization', () => {
  it('tafWithoutValidPeriodIsFreshAt6h59mAndOldAt7h', () => {
    expect([edge('taf', 419).level, edge('taf', 419).text]).toEqual(['fresh', '6h 59m']);
    expect([edge('taf', 420).level, edge('taf', 420).text]).toEqual(['old', 'OLD 7h']);
  });
  it('tafInsideItsValidPeriodStillReadsOldFrom7hOfAge', () => {
    expect([edge('taf', 419, 600).level, edge('taf', 419, 600).text]).toEqual(['fresh', '6h 59m']);
    expect([edge('taf', 420, 600).level, edge('taf', 420, 600).text]).toEqual(['old', 'OLD 7h']);
  });
  it('tafWithoutValidPeriodExpiresByAgeAt30h', () => {
    expect(edge('taf', 30 * 60 - 1).level).toBe('old');
    expect([edge('taf', 48 * 60).level, edge('taf', 48 * 60).text]).toEqual(['expired', 'EXPIRED']);
  });
  it('notamAt359MinutesIsOldAndAt360IsExpired', () => {
    expect([edge('notam', 359).level, edge('notam', 359).text]).toEqual(['old', 'OLD 5h 59m']);
    expect([edge('notam', 360).level, edge('notam', 360).text]).toEqual(['expired', 'EXPIRED']);
  });
  it('pirepAt119MinutesIsOld', () => {
    expect([edge('pirep', 119).level, edge('pirep', 119).text]).toEqual(['old', 'OLD 1h 59m']);
  });
  it('tfrWithPastValidUntilAndFreshFetchIsRedExpired', () => {
    expect([edge('tfr', 10, -1).level, edge('tfr', 10, -1).text]).toEqual(['unsafe', 'EXPIRED']);
  });
  it('tfrWithFutureValidUntilFollowsTheAgeRule', () => {
    expect([edge('tfr', 10, 60).level, edge('tfr', 10, 60).text]).toEqual(['fresh', '10 min']);
    expect([edge('tfr', 180, 60).level, edge('tfr', 180, 60).text]).toEqual(['unsafe', 'EXPIRED']);
  });
  it('metarWithFutureValidUntilIsJudgedByAge', () => {
    expect([edge('metar', 10, 60).level, edge('metar', 10, 60).text]).toEqual(['fresh', '10 min']);
    expect([edge('metar', 240, 60).level, edge('metar', 240, 60).text]).toEqual(['expired', 'EXPIRED']);
  });
  it('metarWithPastValidUntilIsExpiredEvenWhenJustObserved', () => {
    expect([edge('metar', 1, -1).level, edge('metar', 1, -1).text]).toEqual(['expired', 'EXPIRED']);
  });
  it('validUntilEqualToNowIsNotYetExpired', () => {
    expect([edge('metar', 10, 0).level, edge('metar', 10, 0).text]).toEqual(['fresh', '10 min']);
  });
  it('windsAloftWithOnlyAnObservedTimeIsUnknown', () => {
    expect([edge('windsAloft', 1).level, edge('windsAloft', 1).text]).toEqual(['unknown', 'N/A']);
  });
  it('chartCycleExactlySevenDaysLeftReadsExpires7d', () => {
    expect([chart(7).level, chart(7).text]).toEqual(['old', 'EXPIRES 7d']);
  });
  it('chartCycleJustOverSevenDaysLeftReadsValid', () => {
    const r = evaluateFreshness('chartCycle', { validUntil: NOW + 7 * DAY + 1000, now: NOW });
    expect([r.level, r.text]).toEqual(['fresh', 'VALID']);
  });
  it('chartCycleFractionalDaysRoundUp', () => {
    expect(chart(2.5).text).toBe('EXPIRES 3d');
    expect(chart(6.01).text).toBe('EXPIRES 7d');
    expect(chart(0.1).text).toBe('EXPIRES 1d');
  });
  it('chartCycleAtTheExactEndInstantReadsExpires0d', () => {
    expect([chart(0).level, chart(0).text]).toEqual(['old', 'EXPIRES 0d']);
  });
  it('chartCycleIgnoresAnObservedTime', () => {
    const r = evaluateFreshness('chartCycle', { observed: NOW - 365 * DAY, validUntil: NOW + 30 * DAY, now: NOW });
    expect([r.level, r.text]).toEqual(['fresh', 'VALID']);
  });
  it('displayNameForEveryProduct', () => {
    expect(Object.fromEntries(DATA_PRODUCTS.map((p) => [p, productDisplayName(p)]))).toEqual({
      metar: 'METAR',
      taf: 'TAF',
      pirep: 'PIREP',
      windsAloft: 'Winds aloft',
      tfr: 'TFR data',
      airmetSigmet: 'AIRMET/SIGMET data',
      notam: 'NOTAM data',
      chartCycle: 'Chart cycle',
    });
  });
});

describe('Overlay staleness', () => {
  const N = 1_800_000_000_000;
  const at = (min: number) => N - min * MIN;
  it('freshSnapshotIsCurrent', () => {
    expect(evaluateOverlayStaleness('tfr', at(5), N)).toBe('current');
    expect(evaluateOverlayStaleness('airmetSigmet', at(29), N)).toBe('current');
  });
  it('snapshotPastOldThresholdIsStaleNotCurrent', () => {
    expect(evaluateOverlayStaleness('tfr', at(31), N)).toBe('stale');
    expect(evaluateOverlayStaleness('airmetSigmet', at(119), N)).toBe('stale');
  });
  it('snapshotPastExpiryIsHiddenNotDrawn', () => {
    expect(evaluateOverlayStaleness('tfr', at(120), N)).toBe('hidden');
    expect(evaluateOverlayStaleness('airmetSigmet', at(180), N)).toBe('hidden');
  });
  it('neverFetchedIsCurrentSoNothingIsMarked', () => {
    expect(evaluateOverlayStaleness('tfr', null, N)).toBe('current');
  });
});
