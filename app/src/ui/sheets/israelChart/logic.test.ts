// The tap sheet's text decisions. The Swift tests of the values it shows (IsraelChartFeaturesTests, "Tap sheets":
// pointSheetListsEverySegmentDirectionWithItsPublishedAltitude, airspaceSheetKeepsPublishedTextAndFlagsAnInferredReference,
// overlappingAirspacesListProhibitedRestrictedAndDangerFirst) are ported with the domain in
// domain/map/israel/chartFeatures.test.ts; these cover what IsraelChartSheets.swift adds on top.
import type { IsraelAirspaceDetail, IsraelRouteAltitudeRow } from '../../../domain/map/israel';
import { AERODROME_SELECTION, AIRSPACES_SELECTION, LONELY_POINT_SELECTION, POINT_SELECTION } from './fixture';
import {
  AIRSPACE_LABELS,
  NO_SEGMENTS_TEXT,
  ROUTE_SEGMENTS_HEADER,
  airspaceAccessibilityLabel,
  airspaceGridRows,
  airspaceSubtitle,
  closureIsFull,
  closureLines,
  rowAccessibilityLabel,
  segmentTitle,
  sheetContent,
  showsDividerAfter,
} from './logic';

const row = (o: Partial<IsraelRouteAltitudeRow> = {}): IsraelRouteAltitudeRow => ({
  segmentID: 1,
  from: 'GALIM',
  to: 'DAROM',
  altitude: '2500 ft',
  routeType: 'Civil',
  closure: null,
  closureSeverity: null,
  closureNotes: [],
  ...o,
});

const airspace = (o: Partial<IsraelAirspaceDetail> = {}): IsraelAirspaceDetail => ({
  id: 1,
  title: 'LLHZ CTR',
  nameEnglish: null,
  nameHebrew: null,
  typeText: 'CTR (control zone)',
  floor: 'SFC (ground)',
  ceiling: '1500 ft MSL',
  rawText: null,
  authority: null,
  referenceNote: null,
  ...o,
});

const point = () => {
  if (POINT_SELECTION.kind !== 'point') throw new Error('fixture');
  return POINT_SELECTION.detail;
};
const airspaces = () => {
  if (AIRSPACES_SELECTION.kind !== 'airspaces') throw new Error('fixture');
  return AIRSPACES_SELECTION.details;
};

describe('fixed text', () => {
  test('headerAndEmptyTextAreSwifts', () => {
    expect(ROUTE_SEGMENTS_HEADER).toBe('ROUTE SEGMENTS (ALTITUDE FT MSL, PUBLISHED)');
    expect(NO_SEGMENTS_TEXT).toBe('No CVFR route segment ends here.');
    expect(Object.values(AIRSPACE_LABELS)).toEqual(['Ceiling', 'Floor', 'Authority', 'Chart text']);
  });
});

describe('sheetContent', () => {
  test('pointAndAirspacesAreShownAnAerodromeNever', () => {
    expect(sheetContent(POINT_SELECTION)).toEqual({ kind: 'point', detail: point() });
    expect(sheetContent(AIRSPACES_SELECTION)).toEqual({ kind: 'airspaces', details: airspaces() });
    expect(sheetContent(AERODROME_SELECTION)).toBeNull();
  });
});

describe('point rows', () => {
  test('directionUsesARightArrow', () => {
    expect(segmentTitle(row())).toBe('GALIM \u2192 DAROM');
  });

  test('onlyPartialAndCheckClosuresAreAmber', () => {
    expect(closureIsFull(row({ closure: 'CLSD', closureSeverity: 'full' }))).toBe(true);
    expect(closureIsFull(row({ closure: 'CLSD', closureSeverity: 'partial' }))).toBe(false);
    expect(closureIsFull(row({ closure: 'CHECK NOTAM', closureSeverity: 'check' }))).toBe(false);
    // Swift compares against .partial and .check, so a closure without a severity is drawn as full.
    expect(closureIsFull(row({ closure: 'CLSD', closureSeverity: null }))).toBe(true);
  });

  test('closureLinesCarryTheNotesAndAreAbsentWithoutAClosure', () => {
    expect(closureLines(row())).toBeNull();
    expect(
      closureLines(row({ closure: 'CLSD 1500-2000 ft', closureSeverity: 'partial', closureNotes: ['EXC MIL'] })),
    ).toEqual({ text: 'CLSD 1500-2000 ft', full: false, notes: ['EXC MIL'] });
  });

  test('aRowReadsAsOneElementWithItsClosure', () => {
    expect(rowAccessibilityLabel(row())).toBe('GALIM \u2192 DAROM, 2500 ft, Civil');
    expect(
      rowAccessibilityLabel(
        row({ closure: 'CLSD to 13:30Z', closureSeverity: 'full', closureNotes: ['EXC SAR', 'EXC MEDEVAC'] }),
      ),
    ).toBe('GALIM \u2192 DAROM, 2500 ft, Civil, CLSD to 13:30Z, EXC SAR, EXC MEDEVAC');
  });

  test('fixturePointHasEveryDirectionLeavingFirst', () => {
    expect(point().rows.map(segmentTitle)).toEqual([
      'SHARO \u2192 DEROR',
      'SHARO \u2192 HADRA',
      'SHARO \u2192 OLGAA',
      'DEROR \u2192 SHARO',
      'HADRA \u2192 SHARO',
      'OLGAA \u2192 SHARO',
    ]);
    if (LONELY_POINT_SELECTION.kind !== 'point') throw new Error('fixture');
    expect(LONELY_POINT_SELECTION.detail.rows).toEqual([]);
  });
});

describe('airspace detail', () => {
  test('englishNameIsHiddenWhenItRepeatsTheTitle', () => {
    expect(airspaceSubtitle(airspace())).toBeNull();
    expect(airspaceSubtitle(airspace({ title: 'Hof Dor', nameEnglish: 'Hof Dor' }))).toBeNull();
    expect(airspaceSubtitle(airspace({ nameEnglish: 'Herzliya' }))).toBe('Herzliya');
  });

  test('gridShowsCeilingThenFloorAndOptionalRowsOnlyWhenPublished', () => {
    expect(airspaceGridRows(airspace()).map((r) => [r.label, r.value, r.emphasis])).toEqual([
      ['Ceiling', '1500 ft MSL', true],
      ['Floor', 'SFC (ground)', true],
    ]);
    expect(
      airspaceGridRows(airspace({ authority: 'Military', rawText: 'LLBG TMA 2 500 - 8 000' })).map((r) => [
        r.label,
        r.value,
        r.emphasis,
      ]),
    ).toEqual([
      ['Ceiling', '1500 ft MSL', true],
      ['Floor', 'SFC (ground)', true],
      ['Authority', 'Military', false],
      ['Chart text', 'LLBG TMA 2 500 - 8 000', false],
    ]);
  });

  test('anAirspaceReadsAsOneElementInDisplayOrder', () => {
    expect(
      airspaceAccessibilityLabel(
        airspace({
          nameEnglish: 'Herzliya',
          nameHebrew: 'הרצליה',
          authority: 'Civil',
          referenceNote: 'Check the AIP.',
        }),
      ),
    ).toBe(
      'LLHZ CTR, Herzliya, הרצליה, CTR (control zone), Ceiling, 1500 ft MSL, Floor, SFC (ground), Authority, Civil, Check the AIP.',
    );
  });

  test('dividersSeparateAirspacesButNotAfterTheLast', () => {
    const details = [airspace({ id: 2 }), airspace({ id: 1 }), airspace({ id: 3 })];
    expect(details.map((_, i) => showsDividerAfter(details, i))).toEqual([true, true, false]);
    expect(showsDividerAfter([airspace()], 0)).toBe(false);
    expect(showsDividerAfter([], 0)).toBe(false);
  });

  test('fixtureAirspacesShowTheDomainTextRestrictedFirst', () => {
    const [restricted, danger, tma] = airspaces();
    expect(restricted).toMatchObject({
      title: 'LLR104',
      typeText: 'R (restricted area)',
      ceiling: '3000/3500 ft (as published)',
      floor: 'SFC (ground)',
      authority: 'Military',
      referenceNote: null,
    });
    expect(danger).toMatchObject({ title: 'Hof Dor', ceiling: 'FL95', floor: 'not published', authority: null });
    expect(airspaceSubtitle(danger!)).toBeNull();
    expect(tma).toMatchObject({
      title: 'LLBG TMA',
      nameEnglish: 'Ben Gurion TMA 2',
      typeText: 'TMA (terminal control area)',
      ceiling: '8000 ft MSL',
      floor: '2500 ft MSL',
      rawText: 'LLBG TMA 2 500 - 8 000',
      authority: 'Civil',
    });
    expect(tma?.referenceNote).toMatch(/inferred/);
  });
});
