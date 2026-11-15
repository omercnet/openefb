import { press, render } from '../../../../tests/support/ui';
import type { Notam, NotamReport } from '../../../services/notam';
import { NotamsSection, NOTAM_INCOMPLETE, NOTAM_REFRESH_FAILED } from './notamSection';
import type { AirportColumnData, AirportColumnModel, NotamState } from './store';

const NOW = Date.UTC(2026, 10, 12, 12, 0);
const notam = (id: string, text: string, over: Partial<Notam> = {}): Notam =>
  ({
    id,
    number: `10/${id}`,
    series: null,
    type: 'N',
    issued: null,
    effectiveStart: NOW - 3_600_000,
    effectiveEnd: NOW + 3_600_000,
    isPermanent: false,
    text,
    fullText: `FULL ${text}`,
    classification: null,
    location: 'SQL',
    icaoLocation: 'KSQL',
    selectionCode: null,
    schedule: null,
    ...over,
  }) as Notam;

const report = (over: Partial<NotamReport> = {}): NotamReport => ({
  location: 'SQL',
  notams: [notam('1', 'RWY 12/30 CLSD'), notam('2', 'OBST TOWER LGT OUT')],
  fetchedAt: NOW - 60_000,
  refreshFailed: false,
  isIncomplete: false,
  ...over,
});

const model = (notams: NotamState | undefined, retry = jest.fn()): AirportColumnModel =>
  ({
    icao: 'KSQL',
    data: { notamKeyConfigured: false, notams } as AirportColumnData,
    station: null,
    region: 'us',
    now: NOW,
    retryNotams: retry,
  }) as unknown as AirportColumnModel;

const has = (view: Awaited<ReturnType<typeof render>>, id: string) =>
  view.all((n) => n.props?.testID === id).length > 0;

describe('NotamsSection', () => {
  it('shows the key hint for a column that never asked for NOTAMs', async () => {
    const view = await render(<NotamsSection model={model(undefined)} />);
    expect(has(view, 'airport-notam-key-hint')).toBe(true);
  });

  it('loading, no key, rejected key', async () => {
    expect(has(await render(<NotamsSection model={model({ kind: 'loading' })} />), 'airport-notams-loading')).toBe(
      true,
    );
    expect(
      has(await render(<NotamsSection model={model({ kind: 'notConfigured' })} />), 'airport-notam-key-hint'),
    ).toBe(true);
    const rejected = await render(
      <NotamsSection model={model({ kind: 'credentialsRejected', message: 'The FAA rejected the key.' })} />,
    );
    expect(rejected.text()).toContain('The FAA rejected the key.');
  });

  it('a failed download says why and Retry loads again', async () => {
    const retry = jest.fn();
    const view = await render(<NotamsSection model={model({ kind: 'failed', message: 'offline' }, retry)} />);
    expect(view.text()).toContain('NOTAMs not loaded: offline');
    await press(view.byTestId('airport-notams-retry'));
    expect(retry).toHaveBeenCalled();
  });

  it('lists the NOTAMs with the closure badge, and a tap expands one to its full text', async () => {
    const view = await render(<NotamsSection model={model({ kind: 'loaded', report: report() })} />);
    expect(view.text()).toContain('RWY CLSD');
    expect(view.text()).toContain('OBST TOWER LGT OUT');
    expect(view.text()).not.toContain('FULL OBST TOWER LGT OUT');
    await press(view.byTestId('notam-2'));
    expect(view.text()).toContain('FULL OBST TOWER LGT OUT');
    await press(view.byTestId('notam-2'));
    expect(view.text()).not.toContain('FULL OBST TOWER LGT OUT');
  });

  it('warns when the refresh failed (with Retry) and when the list is incomplete', async () => {
    const retry = jest.fn();
    const view = await render(
      <NotamsSection
        model={model({ kind: 'loaded', report: report({ refreshFailed: true, isIncomplete: true }) }, retry)}
      />,
    );
    expect(view.text()).toContain(NOTAM_REFRESH_FAILED);
    expect(view.text()).toContain(NOTAM_INCOMPLETE);
    await press(view.byTestId('airport-notams-retry'));
    expect(retry).toHaveBeenCalled();
  });

  it('an empty list says so, differently when it is only the saved copy', async () => {
    const fresh = await render(<NotamsSection model={model({ kind: 'loaded', report: report({ notams: [] }) })} />);
    expect(fresh.text()).toContain('No active NOTAMs for SQL');
    const saved = await render(
      <NotamsSection model={model({ kind: 'loaded', report: report({ notams: [], refreshFailed: true }) })} />,
    );
    expect(saved.text()).toContain('No active NOTAMs in the saved copy for SQL');
  });
});
