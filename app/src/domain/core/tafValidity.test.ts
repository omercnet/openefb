import { tafValidUntil } from './tafValidity';

const utc = (iso: string): number => Date.parse(iso);

describe('TAF validity', () => {
  it('readsTheEndOfTheValidPeriodFromTheTafText', () => {
    const now = utc('2026-11-02T18:00:00Z');
    expect(tafValidUntil('TAF KPAO 021720Z 0218/0306 27008KT', now)).toBe(utc('2026-11-03T06:00:00Z'));
  });
  it('hour24MeansMidnightAtTheEndOfThatDay', () => {
    const now = utc('2026-11-02T18:00:00Z');
    expect(tafValidUntil('TAF KPAO 021720Z 0218/0324 27008KT', now)).toBe(utc('2026-11-04T00:00:00Z'));
  });
  it('aValidPeriodAcrossAMonthBoundaryResolvesToTheNextMonth', () => {
    const now = utc('2026-11-30T20:00:00Z');
    expect(tafValidUntil('TAF KPAO 301720Z 3018/0124 27008KT', now)).toBe(utc('2026-12-02T00:00:00Z'));
  });
  it('aTafWithoutAValidPeriodHasNoEnd', () => {
    expect(tafValidUntil('no forecast here 1/2SM', Date.now())).toBeNull();
  });
  it('rejectsOutOfRangeDayAndHour', () => {
    expect(tafValidUntil('TAF X 0218/0025 00000KT', 0)).toBeNull();
    expect(tafValidUntil('TAF X 0218/3200 00000KT', 0)).toBeNull();
    expect(tafValidUntil('TAF X 0218/0225 00000KT', 0)).toBeNull();
  });
});
