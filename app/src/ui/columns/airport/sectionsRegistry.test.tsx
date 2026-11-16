import { render } from '../../../../tests/support/ui';
import { shownSections } from './sections';
import type { AirportColumnData, AirportColumnModel } from './store';

jest.mock('./sections/PirepSection', () => ({ PirepSection: jest.fn(() => null) }));
jest.mock('./sections/WindsAloftSection', () => ({ WindsAloftSection: jest.fn(() => null) }));

const airport = { icao: 'KSQL', latitude: 37.5, longitude: -122.25 };
const model = (region: 'us' | 'israel', data: Partial<AirportColumnData>, over: Partial<AirportColumnModel> = {}) =>
  ({
    icao: 'KSQL',
    region,
    now: 1_000,
    station: null,
    data: { airport, ...data } as AirportColumnData,
    ...over,
  }) as AirportColumnModel;
const ids = (m: AirportColumnModel) => shownSections(m).map((s) => s.id);

describe('PIREP and winds aloft sections in the airport column', () => {
  const state = {
    pireps: { loading: false, error: null, pireps: [] },
    winds: { forecast: 6 as const, loading: false, error: null, report: null },
  };

  it('come after the charts, in the regions that have the layers and once their state exists', () => {
    const list = ids(model('us', state));
    expect(list.indexOf('pireps')).toBeGreaterThan(list.indexOf('charts'));
    expect(list.indexOf('winds')).toBeGreaterThan(list.indexOf('pireps'));
  });

  it('are not shown in Israel (no such layers) or before the column asked for them', () => {
    expect(ids(model('israel', state))).not.toContain('pireps');
    expect(ids(model('israel', state))).not.toContain('winds');
    expect(ids(model('us', {}))).not.toContain('pireps');
    expect(ids(model('us', {}))).not.toContain('winds');
  });

  it('are fed from the column state: retry, forecast choice, clock', async () => {
    const { PirepSection } = jest.requireMock('./sections/PirepSection') as { PirepSection: jest.Mock };
    const { WindsAloftSection } = jest.requireMock('./sections/WindsAloftSection') as { WindsAloftSection: jest.Mock };
    const retryPireps = jest.fn();
    const retryWinds = jest.fn();
    const selectWindsForecast = jest.fn();
    const m = model('us', state, { retryPireps, retryWinds, selectWindsForecast });
    const pirep = shownSections(m).find((s) => s.id === 'pireps')!;
    const winds = shownSections(m).find((s) => s.id === 'winds')!;
    await render(
      <>
        <pirep.Component model={m} />
        <winds.Component model={m} />
      </>,
    );
    const pirepProps = PirepSection.mock.calls.at(-1)![0];
    expect(pirepProps).toMatchObject({ airport, loading: false, error: null, pireps: [], now: 1_000 });
    pirepProps.onRetry();
    expect(retryPireps).toHaveBeenCalled();
    const windsProps = WindsAloftSection.mock.calls.at(-1)![0];
    expect(windsProps).toMatchObject({ airport, forecast: 6, report: null });
    windsProps.onSelectForecast(12);
    expect(selectWindsForecast).toHaveBeenCalledWith(12);
    windsProps.onRetry();
    expect(retryWinds).toHaveBeenCalled();
  });
});
