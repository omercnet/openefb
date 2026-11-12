// Render tests of the briefing sheet (Views/Briefing/IsraelBriefingView.swift has no view tests): the capture fixture's
// expired feed, the stale gate, read/unread, raw text, filters and "Show on map".
import { Alert } from 'react-native';
import { press, render, callHandler } from '../../../../tests/support/ui';
import { FIXTURE_NOW, MemoryNotamReadStore, captureBriefingData, fixtureReport } from './fixture';
import { IsraelBriefingSheet } from './IsraelBriefingSheet';
import { IsraelBriefingViewModel, briefing, noBriefingActions, type BriefingActions } from './store';

async function renderSheet(actions: Partial<BriefingActions> = {}) {
  const readStore = new MemoryNotamReadStore();
  const model = new IsraelBriefingViewModel(briefing.make(captureBriefingData()), {
    fetcher: async () => fixtureReport(),
    readStore,
    now: () => FIXTURE_NOW,
  });
  const view = await render(<IsraelBriefingSheet model={model} actions={{ ...noBriefingActions, ...actions }} />);
  return { view, model, readStore };
}

describe('IsraelBriefingSheet', () => {
  it('shows the capture: an expired 117-NOTAM feed hidden behind the stale gate, filters on the route', async () => {
    const { view, model } = await renderSheet();
    const text = view.text();
    expect(text).toContain('NOTAM briefing');
    expect(text).toContain('Feed');
    expect(text).toContain('EXPIRED');
    expect(text).toContain('117 NOTAMs');
    expect(text).toContain('NOTAM feed is EXPIRED. The list is not current and is hidden. Check NOTAMs with the IAA.');
    expect(text).toContain('Show last known list anyway');
    expect(text).toContain('Flight \u00B7 Route 25 NM');
    expect(text).toContain('IMS aviation: SIGMET, AIRMET, forecasts');
    expect(text).not.toContain('Closures');
    expect(model.unreadCount).toBe(0);
    await press(view.byTestId('briefing-mark-all-read')); // disabled: nothing listed
    expect(model.store.getState().readVersion).toBe(0);
  });

  it('lists the last known feed on request, closures first, and marks rows read', async () => {
    const { view, model, readStore } = await renderSheet();
    await press(view.byTestId('briefing-show-stale'));
    const text = view.text();
    expect(text).toContain('Showing a stale list. It is NOT current.');
    expect(text).toContain('Closures');
    expect(text).toContain('CLOSED');
    expect(text).toContain('PARTIAL');
    expect(text).toContain('HEL ROUTE CLSD');
    expect(text).toContain('Aerodromes on route');
    expect(text).toContain('REPLACES');
    expect(view.byLabel('C2311/26, LLLL, unread, CLOSED')).toHaveLength(1); // the closure status is spoken in the row label
    await press(view.byTestId('briefing-row-C2311/26'));
    expect(view.byLabel('C2311/26, LLLL, read, CLOSED')).toHaveLength(1);
    expect(model.unreadCount).toBeGreaterThan(0);
    await press(view.byTestId('briefing-mark-all-read'));
    expect(model.unreadCount).toBe(0);
    expect(readStore.keys.size).toBeGreaterThan(1);
  });

  it('speaks CLOSED, PARTIAL and the other-network status in the row labels, not only in the badges', async () => {
    const { view } = await renderSheet();
    await press(view.byTestId('briefing-show-stale'));
    const labels = view
      .all((n) => String(n.props?.testID ?? '').startsWith('briefing-row-'))
      .map((n) => String(n.props.accessibilityLabel));
    expect(labels.some((l) => l.endsWith(', CLOSED'))).toBe(true);
    expect(labels.some((l) => l.endsWith(', PARTIAL'))).toBe(true);
    expect(labels.some((l) => l.includes('routes closed. Not your route network.'))).toBe(true);
    // Every row that shows a closure badge speaks it.
    for (const badge of ['CLOSED', 'PARTIAL', 'CHECK NOTAM']) {
      const shown = view.all(
        (n) => n.props?.testID === `briefing-badge-${badge.toLowerCase().replaceAll(' ', '-')}`,
      ).length;
      expect(labels.filter((l) => l.endsWith(`, ${badge}`)).length).toBe(shown);
    }
  });

  it('expands the raw text and opens the filters', async () => {
    const { view, model } = await renderSheet();
    await press(view.byTestId('briefing-show-stale'));
    const raw = view.byLabel('Raw')[0];
    await press(raw);
    expect(view.text()).toContain('Hide raw');
    await press(view.byTestId('briefing-filters-toggle'));
    expect(view.text()).toContain('Within 25 NM');
    await press(view.byTestId('briefing-corridor-plus'));
    expect(model.corridorNM).toBe(30);
    await press(view.byTestId('briefing-window-next24h'));
    expect(view.text()).toContain('24 h \u00B7 Route 30 NM');
    await callHandler(view.byTestId('briefing-aerodrome'), 'onChangeText', 'llhz');
    expect(view.text()).toContain('LLHZ');
    await callHandler(view.byTestId('briefing-unread-only'), 'onValueChange', true);
    expect(model.unreadOnly).toBe(true);
  });

  it('shows a NOTAM on the map and dismisses, or says there is nothing to show', async () => {
    const dismiss = jest.fn();
    const showOnMap = jest.fn(() => true);
    const { view } = await renderSheet({ dismiss, showOnMap });
    await press(view.byTestId('briefing-show-stale'));
    await press(view.byLabel('Show on map')[0]);
    expect(showOnMap).toHaveBeenCalledWith(expect.objectContaining({ id: 'C2311/26' }), 'closure');
    expect(dismiss).toHaveBeenCalledTimes(1);

    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    showOnMap.mockReturnValue(false);
    await press(view.byLabel('Show on map')[0]);
    expect(alert).toHaveBeenCalledWith(
      'Nothing to show',
      'The map is not ready, or this NOTAM has no area or route to draw.',
      expect.anything(),
    );
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('opens the IMS aviation page and closes with Done', async () => {
    const openURL = jest.fn();
    const dismiss = jest.fn();
    const { view } = await renderSheet({ openURL, dismiss });
    await press(view.byTestId('briefing-ims-link'));
    expect(openURL).toHaveBeenCalledWith('https://ims.gov.il/en/aviation');
    await press(view.byLabel('Done')[0]);
    expect(dismiss).toHaveBeenCalled();
  });
});
