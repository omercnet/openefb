import { render } from '../../../../tests/support/ui';
import type { IsraelAerodrome, IsraelAerodromeRunway } from '../../../data/aviation/israelTypes';
import { IsraelAerodromeSection } from './israelAerodromeSection';
import {
  circuitText,
  dimensions,
  groupLabel,
  number,
  pprText,
  spoken,
  surfaceAndHeading,
  useNote,
} from './israelAerodromeLogic';
import { shownSections } from './sections';
import type { AirportColumnModel } from './store';

const runway = (over: Partial<IsraelAerodromeRunway> = {}): IsraelAerodromeRunway => ({
  id: 1,
  designator: '10/28',
  lengthMetres: 903,
  widthMetres: 18,
  surface: 'asphalt',
  headingA: 98,
  headingB: 278,
  headingIsTrue: false,
  ...over,
});

const aerodrome = (over: Partial<IsraelAerodrome> = {}): IsraelAerodrome =>
  ({
    id: 1,
    code: 'LLHZ',
    nameHebrew: 'הרצליה',
    nameEnglish: 'Herzliya',
    type: 'airport',
    use: 'civil',
    latitude: 32.18,
    longitude: 34.83,
    elevationFeet: 135,
    circuitAltitudeFeet: 1000,
    circuitDirection: 'left',
    hours: 'Sunrise to sunset',
    ppr: 'yes',
    pprText: 'Call 24 h before',
    remarks: 'Noise abatement',
    sources: {
      identity: 'AIP 2026',
      runways: 'AIP 2026',
      frequencies: null,
      circuit: null,
      hours: null,
      remarks: 'AIP',
    },
    uncertainGroups: [],
    notes: null,
    reviewStatus: 'reviewed',
    runways: [runway()],
    frequencies: [],
    ...over,
  }) as IsraelAerodrome;

describe('Israel aerodrome text', () => {
  it('words the PPR, the use and the circuit as Swift does', () => {
    expect(pprText({ ppr: 'yes', pprText: 'Call' })).toBe('Required. Call');
    expect(pprText({ ppr: 'no', pprText: null })).toBe('Not required');
    expect(pprText({ ppr: 'unknown', pprText: null })).toBe('Not stated in the AIP');
    expect(useNote('civil')).toBeNull();
    expect(useNote('military')).toBe('Military field: operation needs CAAI authorization');
    expect(circuitText({ circuitAltitudeFeet: 1000, circuitDirection: 'left' })).toBe("1000' MSL, left");
    expect(circuitText({ circuitAltitudeFeet: null, circuitDirection: null })).toBeNull();
    expect(groupLabel('elevation_ft')).toBe('elevation');
    expect(groupLabel('identity')).toBe('position');
    expect(groupLabel('hours')).toBe('hours');
  });

  it('prints runways in metres with feet, surface and heading', () => {
    expect(dimensions(runway())).toBe('903 x 18 m  (2963 ft)');
    expect(surfaceAndHeading(runway())).toBe('Asphalt, 98/278\u00B0 magnetic');
    expect(surfaceAndHeading(runway({ surface: 'unknown', headingA: null }))).toBe('surface not published');
    expect(spoken(runway())).toBe('903 by 18 metres, Asphalt, 98/278\u00B0 magnetic');
    expect(number(12.5)).toBe('12.5');
    expect(number(12)).toBe('12');
  });
});

describe('IsraelAerodromeSection', () => {
  it('shows a reviewed aerodrome: operations, runways, remarks, sources', async () => {
    const view = await render(<IsraelAerodromeSection aerodrome={aerodrome()} />);
    const text = view.text();
    expect(text).toContain('Required. Call before'.replace('Call before', 'Call 24 h before'));
    expect(text).toContain('Sunrise to sunset');
    expect(text).toContain("1000' MSL, left");
    expect(text).toContain('903 x 18 m  (2963 ft)');
    expect(text).toContain('Noise abatement');
    expect(text).toContain('Position, elevation: AIP 2026');
    expect(text).toContain('Reviewed against the AIP.');
    expect(view.all((n) => n.props?.testID === 'israel-unreviewed-note')).toHaveLength(0);
  });

  it('an unreviewed one carries the caution and what the curator was unsure about', async () => {
    const view = await render(
      <IsraelAerodromeSection
        aerodrome={aerodrome({ reviewStatus: 'unreviewed', uncertainGroups: ['identity', 'hours'] })}
      />,
    );
    expect(view.text()).toContain('Unreviewed data');
    expect(view.text()).toContain('The curator is unsure about: position, hours.');
    expect(view.text()).toContain('Not yet reviewed against the AIP.');
  });

  it('a field with no runway data says so', async () => {
    const view = await render(<IsraelAerodromeSection aerodrome={aerodrome({ runways: [] })} />);
    expect(view.text()).toContain('No runway data published');
  });
});

describe('the column registry', () => {
  const model = (data: unknown): AirportColumnModel =>
    ({ icao: 'LLHZ', data, station: null, region: 'israel', now: 0 }) as unknown as AirportColumnModel;
  const ids = (m: AirportColumnModel) => shownSections(m).map((s) => s.id);

  it('an Israeli aerodrome replaces the generic runways with its own section', () => {
    expect(ids(model({ aerodrome: aerodrome() }))).toContain('israel-aerodrome');
    expect(ids(model({ aerodrome: aerodrome() }))).not.toContain('runways');
    expect(ids(model({}))).toContain('runways');
  });
});
