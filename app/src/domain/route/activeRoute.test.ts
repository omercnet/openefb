import {
  type ActiveRoute,
  advance,
  ARRIVAL_RADIUS_NM,
  currentLeg,
  departureCode,
  departureCoordinate,
  destinationCode,
  destinationCoordinate,
  emptyFollowing,
  goBack,
  isLastLeg,
  legPublishedAltitudesFeet,
  legVertices,
  makeActiveRoute,
  makeLeg,
  nextLeg,
  remainingNm,
} from './activeRoute';

const leg = (from: string, to: string, nm: number, extra = {}) =>
  makeLeg({
    fromCode: from,
    toCode: to,
    fromLatitude: 1,
    fromLongitude: 2,
    toLatitude: 3,
    toLongitude: 4,
    altitudeText: '1500',
    distanceNM: nm,
    ...extra,
  });

const route = () => makeActiveRoute([leg('A', 'B', 10), leg('B', 'C', 20), leg('C', 'D', 30)]);

describe('ActiveRoute', () => {
  it('exposes departure, destination, current and next', () => {
    const r = route();
    expect([departureCode(r), destinationCode(r)]).toEqual(['A', 'D']);
    expect(departureCoordinate(r)).toEqual({ lat: 1, lon: 2 });
    expect(destinationCoordinate(r)).toEqual({ lat: 3, lon: 4 });
    expect(currentLeg(r)?.toCode).toBe('B');
    expect(nextLeg(r)?.toCode).toBe('C');
    expect(isLastLeg(r)).toBe(false);
  });

  it('an empty route has no endpoints', () => {
    const r = makeActiveRoute([]);
    expect([currentLeg(r), nextLeg(r), departureCode(r), destinationCode(r), departureCoordinate(r)]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(isLastLeg(r)).toBe(true);
  });

  it('advance moves one leg, resets following, and stops on the last leg', () => {
    let r: ActiveRoute = { ...route(), following: { ...emptyFollowing(), isOffRoute: true, crossTrackNM: 2 } };
    r = advance(r);
    expect(r.currentLeg).toBe(1);
    expect(r.following).toEqual(emptyFollowing());
    r = advance(r);
    expect(isLastLeg(r)).toBe(true);
    const stuck = { ...r, following: { ...emptyFollowing(), isOffRoute: true } };
    expect(advance(stuck)).toBe(stuck);
  });

  it('goBack moves one leg back, resets following, and stops at the first', () => {
    let r = advance(advance(route()));
    r = goBack({ ...r, following: { ...emptyFollowing(), isOffRoute: true } });
    expect(r.currentLeg).toBe(1);
    expect(r.following).toEqual(emptyFollowing());
    r = goBack(r);
    const first = { ...r, following: { ...emptyFollowing(), isOffRoute: true } };
    expect(goBack(first)).toBe(first);
  });

  it('remainingNm adds the legs after the current one', () => {
    expect(remainingNm(route(), 4)).toBe(54);
    expect(remainingNm(advance(advance(route())), 4)).toBe(4);
  });

  it('vertices use the path when it has 2+ points, else the straight line', () => {
    expect(legVertices(leg('A', 'B', 1))).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(legVertices(leg('A', 'B', 1, { path: [[9, 9]] }))).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(
      legVertices(
        leg('A', 'B', 1, {
          path: [
            [5, 6],
            [7, 8],
            [9, 10],
          ],
        }),
      ),
    ).toHaveLength(3);
  });

  it('published altitudes are every digit run in the text', () => {
    expect(legPublishedAltitudesFeet(leg('A', 'B', 1, { altitudeText: '1500' }))).toEqual([1500]);
    expect(legPublishedAltitudesFeet(leg('A', 'B', 1, { altitudeText: '2500 / 1500' }))).toEqual([2500, 1500]);
    expect(legPublishedAltitudesFeet(leg('A', 'B', 1, { altitudeText: 'SFC' }))).toEqual([]);
  });

  it('defaults', () => {
    const r = route();
    expect(r.offRouteThresholdNM).toBe(1);
    expect(ARRIVAL_RADIUS_NM).toBe(0.5);
    expect(r.legs[0].segmentID).toBe(0);
  });
});
