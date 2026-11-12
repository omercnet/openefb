// Port of efb-212Tests/ServiceTests/IsraelChartFeaturesTests.swift (all four suites). Same names, inputs and expected
// values. The closure cases run the chart builder on the real L3 closure mapper (`mapClosures`). One case (AppState region switch) is moved; see
// docs/port-notes/M1-israel.md.
import {
  AIRSPACE_KINDS,
  type IsraelAerodrome,
  type IsraelAerodromeType,
  type IsraelAerodromeUse,
  type IsraelAirspace,
  type IsraelAirspaceKind,
  type IsraelAirspaceLimit,
  type IsraelPointKind,
  type IsraelReportingPoint,
  type IsraelRouteAltitude,
  type IsraelRouteSegment,
} from '../../../data/aviation/israelTypes';
import type { Coordinate } from '../../core';
import {
  CVFR_CHART_DATA_LAYERS,
  CVFR_CHART_LAYERS,
  MAP_LAYERS,
  isCvfrChartLayer,
  isLayerAvailable,
  regionSupports,
} from '../../core';
import type { IsraelRouteClosure } from '../../israel/notamTypes';
import { mapClosures, type IsraelRouteSegmentLookup } from '../../israel/closureMapper';
import { airspaceDetails, limitDetail, pointDetail, referenceNote } from './chartDetails';
import {
  aerodromeLabel,
  aerodromesWithoutPoint,
  airspaceFeatures,
  israelChartDefaultVisibleLayers,
  limitsText,
  midpoint,
  routeStyle,
  segmentFeatures,
  segmentLabel,
  textRotation,
  isRestricted,
} from './chartFeatures';
import {
  closureFeatures,
  israelClosureSet,
  type IsraelChartClosureMark,
  type IsraelChartClosureSet,
  type IsraelAltitudeLimitInput,
  type IsraelAvailableAltitudeInput,
} from './closures';
import { symbolForAerodromeType } from './style';

// MARK: Fixtures

const capitalized = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

function point(
  id: number,
  code: string,
  kind: IsraelPointKind = 'compulsory',
  lat = 32.0,
  lon = 34.8,
): IsraelReportingPoint {
  return {
    id,
    code,
    nameEnglish: capitalized(code),
    nameHebrew: null,
    kind,
    latitude: lat,
    longitude: lon,
    network: 'cvfr',
  };
}

/** Swift `Int(published)`: nil for anything that is not a plain integer. */
const altitude = (published: string): IsraelRouteAltitude => ({
  published,
  feet: /^[+-]?\d+$/.test(published) ? Number(published) : null,
});

interface SegmentOptions {
  bearing?: number;
  forward?: IsraelRouteAltitude | null;
  reverse?: IsraelRouteAltitude | null;
  military?: boolean;
  byRequest?: boolean;
}

function segment(id: number, from: string, to: string, o: SegmentOptions = {}): IsraelRouteSegment {
  const military = o.military ?? false;
  return {
    id,
    fromCode: from,
    toCode: to,
    fromPointID: 1,
    toPointID: 2,
    nameEnglish: null,
    nameHebrew: null,
    lengthNM: 10,
    isCivil: !military,
    isMilitary: military,
    isByRequest: o.byRequest ?? false,
    bearingTrue: o.bearing ?? 90,
    altitudeForward: o.forward ?? null,
    altitudeReverse: o.reverse ?? null,
    lowerAltitudeFeet: null,
    mapSheet: null,
    polyline: [
      { lat: 32.0, lon: 34.8 },
      { lat: 32.0, lon: 35.0 },
    ],
    network: 'cvfr',
    activity: 'unspecified',
    activitySource: null,
    smallOnly: false,
  };
}

const origin: Coordinate = { lat: 32.0, lon: 34.9 };
const limit = (
  feet: number | null,
  reference: IsraelAirspaceLimit['reference'],
  publishedText: string | null = null,
) => ({
  feet,
  reference,
  publishedText,
});

describe('Israel CVFR chart features', () => {
  // MARK: Direction labels

  test('eastboundLabelReadsAlongTheLineWithEachDirectionsAltitude', () => {
    const label = segmentLabel(altitude('2500'), altitude('3000'), 90, origin, false);
    expect(label).not.toBeNull();
    expect(label!.text).toBe('\u21922500 / \u21903000');
    expect(label!.rotationDegrees).toBe(0);
  });

  test('westboundLabelFlipsSoTextIsNeverUpsideDownAndArrowsSwap', () => {
    // from -> to is west (270): text must run east, i.e. along to -> from, so the reverse altitude leads.
    const label = segmentLabel(altitude('2500'), altitude('3000'), 270, origin, false);
    expect(label).not.toBeNull();
    expect(label!.text).toBe('\u21923000 / \u21902500');
    expect(label!.rotationDegrees).toBe(0);
  });

  test('rotationNeverLeavesTheReadableHalfPlane', () => {
    for (let bearing = 0; bearing <= 359; bearing += 1) {
      const rotation = textRotation(bearing);
      expect(rotation >= -90 && rotation <= 90).toBe(true);
    }
  });

  test('twoNumberPublishedAltitudeIsShownAsPublished', () => {
    const twoNumbers: IsraelRouteAltitude = { published: '2500/3500', feet: null };
    const label = segmentLabel(twoNumbers, altitude('3000'), 45, origin, false);
    expect(label?.text).toBe('\u21922500/3500 / \u21903000');
  });

  test('oneDirectionOnlyDropsTheMissingDirection', () => {
    const label = segmentLabel(null, altitude('3500'), 90, origin, false);
    expect(label?.text).toBe('\u21903500');
  });

  test('noPublishedAltitudeMeansNoLabel', () => {
    expect(segmentLabel(null, null, 90, origin, false)).toBeNull();
  });

  test('militaryRoutesAreFlaggedInTheLabel', () => {
    const label = segmentLabel(altitude('2500'), null, 90, origin, true);
    expect(label).not.toBeNull();
    expect(label!.text.endsWith('MIL')).toBe(true);
  });

  test('routeStyleSeparatesCivilByRequestAndMilitary', () => {
    expect(routeStyle(segment(1, 'A', 'B'))).toBe('civil');
    expect(routeStyle(segment(2, 'A', 'B', { byRequest: true }))).toBe('byRequest');
    expect(routeStyle(segment(3, 'A', 'B', { military: true }))).toBe('military');
    // Military wins when a segment is both military and by request: the pilot needs IAF approval first.
    expect(routeStyle(segment(4, 'A', 'B', { military: true, byRequest: true }))).toBe('military');
  });

  test('midpointIsHalfwayAlongTheLengthNotTheMiddleVertex', () => {
    // Vertices 0, 0.1 and 1.0 degrees east: the middle vertex is near one end.
    const line = [
      { lat: 32, lon: 34.0 },
      { lat: 32, lon: 34.1 },
      { lat: 32, lon: 35.0 },
    ];
    const mid = midpoint(line);
    expect(mid).not.toBeNull();
    expect(Math.abs(mid!.lon - 34.5)).toBeLessThan(0.001);
  });

  test('segmentsWithoutAGeometryAreSkipped', () => {
    const broken: IsraelRouteSegment = { ...segment(9, 'A', 'B'), lengthNM: null, bearingTrue: 0, polyline: [origin] };
    expect(segmentFeatures([broken, segment(1, 'A', 'B')]).map((f) => f.id)).toEqual([1]);
  });

  // MARK: Airspace limits

  test('limitsReadSurfaceToCeilingInFeet', () => {
    expect(limitsText(limit(0, 'SFC'), limit(3000, 'MSL'))).toBe('SFC\u20133000');
  });

  test('flightLevelUnlimitedAndTwoNumberLimitsKeepTheirForm', () => {
    expect(limitsText(limit(1500, 'MSL'), limit(9500, 'FL'))).toBe('1500\u2013FL95');
    const sfc = limit(0, 'SFC');
    expect(limitsText(sfc, limit(99000, 'UNL'))).toBe('SFC\u2013UNL');
    expect(limitsText(sfc, limit(3500, 'MSL', '3000/3500'))).toBe('SFC\u20133000/3500');
  });

  test('unpublishedLimitsAreMarkedUnknownNeverInvented', () => {
    const none = limit(null, null);
    expect(limitsText(none, none)).toBe('');
    expect(limitsText(limit(0, 'SFC'), none)).toBe('SFC\u2013?');
  });

  test('prohibitedRestrictedAndDangerAreRestrictedOthersAreNot', () => {
    for (const kind of AIRSPACE_KINDS) {
      expect(isRestricted(kind)).toBe(['P', 'R', 'D'].includes(kind));
    }
  });

  test('firIsNotDrawnAsAnAirspace', () => {
    const ring = [
      { lat: 32, lon: 34 },
      { lat: 32, lon: 35 },
      { lat: 33, lon: 35 },
    ];
    const airspace = (id: number, kind: IsraelAirspaceKind): IsraelAirspace => ({
      id,
      kind,
      code: 'LLX',
      nameEnglish: null,
      nameHebrew: null,
      label: null,
      authority: 'civil',
      floor: limit(0, 'SFC'),
      ceiling: limit(3000, 'MSL'),
      polygons: [[ring]],
    });
    const features = airspaceFeatures([airspace(1, 'FIR'), airspace(2, 'CTR'), airspace(3, 'P')]);
    expect(features.map((f) => f.id)).toEqual([2, 3]);
    expect(features.map((f) => f.isRestricted)).toEqual([false, true]);
  });

  // MARK: Closures

  const now = 1_793_524_800_000; // 2026-11-01 09:20Z

  const closure = (
    chain: string[],
    o: { kind?: string; validFrom?: number; validTo?: number; id?: string } = {},
  ): IsraelRouteClosure => ({
    notamId: o.id ?? 'C1/26',
    routeKind: o.kind ?? 'CVFR',
    routeName: null,
    chain,
    validFrom: o.validFrom ?? now - 3600_000,
    validTo: o.validTo ?? now + 7200_000,
    schedule: null,
  });

  const network = {
    points: [point(1, 'GALIM'), point(2, 'DAROM'), point(3, 'HOTRM')],
    segments: [segment(10, 'GALIM', 'DAROM'), segment(11, 'DAROM', 'HOTRM')],
  };

  /** Swift `closures(from: report(closures:scrapedAgo:), network:, now:)`; null closures = absent feed. Uses the real mapper. */
  async function closures(list: IsraelRouteClosure[] | null, scrapedAgoSeconds = 0): Promise<IsraelChartClosureSet> {
    if (list === null) return israelClosureSet(null, [], now);
    const codes = new Set(network.points.map((p) => p.code.toUpperCase()));
    const find = (a: string, b: string) =>
      network.segments.find(
        (s) => s.fromCode.toUpperCase() === a.toUpperCase() && s.toCode.toUpperCase() === b.toUpperCase(),
      ) ?? null;
    const lookup: IsraelRouteSegmentLookup<IsraelRouteSegment> = {
      knowsPoint: (code) => codes.has(code.toUpperCase()),
      segment: (from, to) => find(from, to) ?? find(to, from),
    };
    const mapping = await mapClosures(list, lookup, now, (s) => s.id);
    return israelClosureSet({ generatedAt: now - scrapedAgoSeconds * 1000 }, mapping.matches, now);
  }

  test('freshClosureMarksTheClosedSegmentWithItsValidity', async () => {
    const set = await closures([closure(['GALIM', 'DAROM'])], 300);
    expect(set.freshness).toBe('fresh');
    expect([...set.marks.keys()].sort((a, b) => a - b)).toEqual([10]);
    const mark = set.marks.get(10);
    expect(mark?.notamID).toBe('C1/26');
    expect(mark?.text).toBe('CLSD to 11:20Z');
  });

  test('closureEndingOnAnotherUTCDayShowsTheDate', async () => {
    const tomorrow = now + 86_400_000;
    const set = await closures([closure(['GALIM', 'DAROM'], { validTo: tomorrow })], 60);
    expect(set.marks.get(10)?.text).toBe('CLSD to 2 Nov 09:20Z');
  });

  test('staleFeedDrawsNoClosuresAtAll', async () => {
    // 7 h since the relay scraped the IAA: past the 6 h NOTAM expiry.
    const set = await closures([closure(['GALIM', 'DAROM'])], 7 * 3600);
    expect(set.marks.size).toBe(0);
    expect(set.freshness).toBe('expired');
    expect(set.generatedAt).not.toBeNull(); // the panel still shows how old it is
  });

  test('oldButNotExpiredFeedDrawsClosuresAndSaysHowOldTheDataIs', async () => {
    const set = await closures([closure(['GALIM', 'DAROM'])], 2 * 3600);
    expect(set.freshness).toBe('old');
    const text = set.marks.get(10)?.text;
    expect(text).toBeDefined();
    expect(text!.endsWith('(data 2h00m old)')).toBe(true);
  });

  test('absentFeedDrawsNothing', async () => {
    const set = await closures(null);
    expect(set.marks.size).toBe(0);
    expect(set.generatedAt).toBeNull();
  });

  test('expiredAndOtherNetworkClosuresAreNotDrawn', async () => {
    const ended = closure(['GALIM', 'DAROM'], { validFrom: now - 7200_000, validTo: now - 60_000 });
    const helicopter = closure(['DAROM', 'HOTRM'], { kind: 'HEL' });
    const set = await closures([ended, helicopter], 60);
    expect(set.marks.size).toBe(0);
  });

  test('closureFeaturesCoverOnlyClosedSegmentsAndRotateWithTheLine', () => {
    const segs = segmentFeatures([
      segment(10, 'GALIM', 'DAROM', { bearing: 90 }),
      segment(11, 'DAROM', 'HOTRM', { bearing: 0 }),
    ]);
    const mark: IsraelChartClosureMark = {
      notamID: 'C1/26',
      text: 'CLSD',
      schedule: null,
      severity: 'full',
      notes: [],
    };
    const features = closureFeatures(
      segs,
      new Map([
        [11, mark],
        [99, mark],
      ]),
    );
    expect(features.map((f) => f.segmentID)).toEqual([11]);
    expect(features[0]?.rotationDegrees).toBe(-90);
    expect(features[0]?.mark).toEqual(mark);
  });

  // MARK: Closure conditions (NOTAM-2)

  const conditional = (
    o: {
      chain?: string[];
      kinds?: string[];
      closed?: IsraelAltitudeLimitInput[];
      available?: IsraelAvailableAltitudeInput[];
      exceptions?: string[];
      partial?: boolean;
      parsed?: boolean;
      raw?: string;
      id?: string;
    } = {},
  ): IsraelRouteClosure => ({
    notamId: o.id ?? 'C1/26',
    routeKind: o.kinds?.[0] ?? 'CVFR',
    routeName: null,
    chain: o.chain ?? ['GALIM', 'DAROM'],
    validFrom: now - 3600_000,
    validTo: null,
    schedule: null,
    routeKinds: o.kinds ?? null,
    closedAltitudes: o.closed ?? null,
    availableAltitudes: o.available ?? null,
    exceptions: o.exceptions ?? null,
    partial: o.partial ?? null,
    parsed: o.parsed ?? null,
    raw: o.raw ?? null,
  });

  const closedAt2500: IsraelAltitudeLimitInput = { op: 'AT', lowerFt: 2500, upperFt: 2500, ref: 'AMSL' };
  const openAt3000: IsraelAvailableAltitudeInput = {
    op: 'AT',
    lowerFt: 3000,
    upperFt: 3000,
    ref: 'AMSL',
    direction: 'BIDIRECTIONAL',
  };

  test('partialClosureIsAmberAndLabelledWithItsAltitudes', async () => {
    const c = conditional({ closed: [closedAt2500], available: [openAt3000], partial: true, parsed: true });
    const mark = await (await closures([c], 60)).marks.get(10);
    expect(mark?.severity).toBe('partial');
    expect(mark?.text).toBe('CLSD 2500 \u00B7 AVBL 3000');
  });

  test('exceptionsAloneReadClsdExcAndTheExceptionTextGoesToTheTapSheet', async () => {
    const c = conditional({ exceptions: ['PPR FLT FM IAF'], partial: true, parsed: true });
    const mark = await (await closures([c], 60)).marks.get(10);
    expect(mark).toBeDefined();
    expect(mark!.text).toBe('CLSD EXC');
    expect(mark!.notes).toEqual(['EXC PPR FLT FM IAF']);
    const detail = pointDetail(point(2, 'DAROM'), [segment(10, 'GALIM', 'DAROM')], new Map([[10, mark!]]));
    expect(
      detail.rows.every((r) => r.closureSeverity === 'partial' && r.closureNotes.join() === 'EXC PPR FLT FM IAF'),
    ).toBe(true);
  });

  test('unreadClosureWithAChainIsAmberCheckNotamWithItsClause', async () => {
    const c = conditional({ parsed: false, raw: 'CVFR RTE CLSD AT 2,500 METRES ALFAB-BRAVO' });
    const mark = await (await closures([c], 60)).marks.get(10);
    expect(mark?.severity).toBe('check');
    expect(mark?.text).toBe('CHECK NOTAM');
    expect(mark?.notes[mark.notes.length - 1]).toBe('CVFR RTE CLSD AT 2,500 METRES ALFAB-BRAVO');
  });

  test('aFullClosureOutranksPartialAndUnreadOnTheSameSegment', async () => {
    const partial = conditional({ closed: [closedAt2500], partial: true, parsed: true, id: 'C1/26' });
    const full = conditional({ id: 'C2/26' });
    const unread = conditional({ parsed: false, id: 'C3/26' });
    for (const order of [
      [partial, unread, full],
      [full, partial, unread],
      [unread, partial, full],
    ]) {
      const set = await closures(order, 60);
      expect(set.marks.get(10)?.severity).toBe('full');
      expect(set.marks.get(10)?.notamID).toBe('C2/26');
    }
    // and an unread closure outranks a partial one
    expect((await closures([partial, unread], 60)).marks.get(10)?.severity).toBe('check');
  });

  test('onlyClosuresThatCoverCVFRAffectTheChart', async () => {
    const both = conditional({ chain: ['GALIM', 'DAROM'], kinds: ['HEL', 'CVFR'] });
    const heliOnly = conditional({ chain: ['DAROM', 'HOTRM'], kinds: ['ULTRALIGHT', 'HEL'] });
    expect([...(await closures([both, heliOnly], 60)).marks.keys()]).toEqual([10]);
  });

  // MARK: Tap sheets

  test('pointSheetListsEverySegmentDirectionWithItsPublishedAltitude', () => {
    const segments = [
      segment(10, 'GALIM', 'DAROM', { forward: altitude('2500'), reverse: { published: '2500/3500', feet: null } }),
      segment(11, 'DAROM', 'HOTRM', { reverse: altitude('1500'), byRequest: true }),
      segment(12, 'XXXXX', 'YYYYY', { forward: altitude('1000') }),
    ];
    const mark: IsraelChartClosureMark = {
      notamID: 'C1/26',
      text: 'CLSD to 11:20Z',
      schedule: null,
      severity: 'full',
      notes: [],
    };
    const detail = pointDetail(point(2, 'DAROM'), segments, new Map([[10, mark]]));
    expect(detail.rows.length).toBe(4); // segment 12 does not touch DAROM
    expect(detail.rows.map((r) => `${r.from}>${r.to}`)).toEqual([
      'DAROM>GALIM',
      'DAROM>HOTRM',
      'GALIM>DAROM',
      'HOTRM>DAROM',
    ]);
    expect(detail.rows[0]?.altitude).toBe('2500/3500 ft');
    expect(detail.rows[0]?.closure).toBe('CLSD to 11:20Z');
    expect(detail.rows[1]?.altitude).toBe('none published');
    expect(detail.rows[1]?.routeType).toBe('By request (ATC approval)');
    expect(detail.kindText).toBe('Compulsory reporting point');
  });

  test('airspaceSheetKeepsPublishedTextAndFlagsAnInferredReference', () => {
    const inferred = limit(3000, 'MSL');
    const sfc = limit(0, 'SFC');
    expect(referenceNote(sfc, inferred)).not.toBeNull();
    expect(referenceNote(sfc, sfc)).toBeNull();
    expect(limitDetail(inferred)).toBe('3000 ft MSL');
    expect(limitDetail(sfc)).toBe('SFC (ground)');
    expect(limitDetail(limit(3500, 'MSL', '3000/3500'))).toBe('3000/3500 ft (as published)');
    expect(limitDetail(limit(null, null))).toBe('not published');
  });

  test('overlappingAirspacesListProhibitedRestrictedAndDangerFirst', () => {
    const airspace = (id: number, kind: IsraelAirspaceKind): IsraelAirspace => ({
      id,
      kind,
      code: `LL${id}`,
      nameEnglish: null,
      nameHebrew: null,
      label: null,
      authority: null,
      floor: limit(0, 'SFC'),
      ceiling: limit(3000, 'MSL'),
      polygons: [],
    });
    expect(airspaceDetails([airspace(1, 'CTR'), airspace(2, 'P'), airspace(3, 'TMA')]).map((d) => d.id)).toEqual([
      2, 1, 3,
    ]);
  });
});

describe('Israel CVFR layer availability', () => {
  test('israelHasTheChartLayersAndTheUSHasNone', () => {
    for (const layer of CVFR_CHART_LAYERS) {
      expect(regionSupports('israel', layer)).toBe(true);
      expect(regionSupports('us', layer)).toBe(false);
    }
    for (const layer of CVFR_CHART_DATA_LAYERS) {
      expect(isLayerAvailable('israel', layer)).toBe(true);
      expect(isLayerAvailable('us', layer)).toBe(false);
    }
  });

  // switchingToIsraelShowsTheChartAndBackToTheUSDropsIt: AppState.visibleLayers; moved (see the port note).

  test('onlyTheChartLayersAreRoutedToTheOverlay', () => {
    for (const layer of MAP_LAYERS) {
      expect(isCvfrChartLayer(layer)).toBe(CVFR_CHART_LAYERS.includes(layer));
    }
    expect(CVFR_CHART_LAYERS.length).toBe(CVFR_CHART_DATA_LAYERS.size);
  });
});

describe('Israel CVFR defaults with the official chart', () => {
  test('officialChartKeepsOnlyClosuresAndTapTargets', () => {
    const on = israelChartDefaultVisibleLayers(true);
    expect(new Set(on)).toEqual(new Set(['cvfrClosures', 'cvfrPoints']));
    expect(on.includes('cvfrRoutes') || on.includes('cvfrAirspace') || on.includes('cvfrRunways')).toBe(false);
  });

  test('streetBaseDrawsEverything', () => {
    expect(new Set(israelChartDefaultVisibleLayers(false))).toEqual(new Set(CVFR_CHART_LAYERS));
  });
});

describe('Israel CVFR aerodromes (IL-4)', () => {
  const aerodrome = (
    code: string,
    o: { type?: IsraelAerodromeType; use?: IsraelAerodromeUse; reviewed?: boolean } = {},
  ): IsraelAerodrome => ({
    id: code.length,
    code,
    nameHebrew: code,
    nameEnglish: code,
    type: o.type ?? 'airstrip',
    use: o.use ?? 'civil',
    latitude: 31.5,
    longitude: 34.8,
    elevationFeet: null,
    circuitAltitudeFeet: null,
    circuitDirection: null,
    hours: null,
    ppr: 'unknown',
    pprText: null,
    remarks: null,
    sources: { identity: 'test', runways: null, frequencies: null, circuit: null, hours: null, remarks: null },
    uncertainGroups: [],
    notes: null,
    reviewStatus: (o.reviewed ?? true) ? 'reviewed' : 'unreviewed',
    runways: [],
    frequencies: [],
  });

  test('onlyAerodromesWithoutAnARPPointAreDrawnAndForeignOnesNever', () => {
    const arp = { ...point(1, 'LLHZ', 'arp', 32, 34), nameEnglish: null };
    const compulsory = { ...point(2, 'NAAN', 'compulsory', 32, 34), nameEnglish: null };
    const drawn = aerodromesWithoutPoint(
      [
        aerodrome('LLHZ', { type: 'airport' }),
        aerodrome('NAAN'),
        aerodrome('llar'),
        aerodrome('OJAM', { use: 'foreign' }),
      ],
      [arp, compulsory],
    ).map((a) => a.code);
    // NAAN is a compulsory point, not an ARP, so the strip still gets its own symbol.
    expect(drawn).toEqual(['NAAN', 'llar']);
  });

  test('unreviewedAerodromesAreStarred', () => {
    expect(aerodromeLabel(aerodrome('SAAD'))).toBe('SAAD');
    expect(aerodromeLabel(aerodrome('SAAD', { reviewed: false }))).toBe('SAAD*');
  });

  test('symbolFollowsAerodromeType', () => {
    expect(symbolForAerodromeType('airport')).toBe('aerodrome');
    expect(symbolForAerodromeType('airstrip')).toBe('airstrip');
    expect(symbolForAerodromeType('heliport')).toBe('heliport');
  });
});
