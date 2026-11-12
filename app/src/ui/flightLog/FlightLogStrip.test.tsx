import { act, type ReactElement } from 'react';
import { callHandler, press, render, type Rendered } from '../../../tests/support/ui';
import { makeAirport } from '../../domain/core';
import type { GpsData } from '../state/gps';
import { gps } from '../state/gps';
import { panels, type PanelsData } from '../state/panels';
import { appStore } from '../state/appStore';
import { nearest, type NearestAirportEntry } from '../columns/nearest/store';
import { ThemeContext } from '../Primitives';
import { Day, Night, type Theme } from '../tokens';
import { dayFixture, noNavigationFixture, predictedEvents, routeFixture } from './fixtures';
import { FlightLogHeader } from './FlightLogHeader';
import { FlightLogStrip } from './FlightLogStrip';
import { flightLog, type FlightLogActions, type FlightLogData } from './store';

const DOT = ' \u00B7 ';
const defaultPanels: PanelsData = { showsFlightLog: true, showsInstruments: true, showsPredictions: false };

function actionSpies(): FlightLogActions {
  return {
    clear: jest.fn(),
    sequenceRoute: jest.fn(),
    openLog: jest.fn(),
    openBriefing: jest.fn(),
    record: jest.fn(),
    openSettings: jest.fn(),
  };
}

interface Setup {
  data?: Partial<FlightLogData>;
  gps?: GpsData;
  panels?: Partial<PanelsData>;
  nearestEntry?: NearestAirportEntry;
  theme?: Theme;
  element?: ReactElement;
}

async function renderStrip(setup: Setup = {}) {
  const actions = actionSpies();
  const store = flightLog.make({ ...dayFixture, ...setup.data, actions });
  const gpsStore = gps.make(setup.gps ?? { status: { kind: 'ok' }, failure: null });
  const view = await render(
    <ThemeContext.Provider value={setup.theme ?? Day}>
      <flightLog.Provider store={store}>
        <gps.Provider store={gpsStore}>
          <panels.Provider store={panels.make({ ...defaultPanels, ...setup.panels })}>
            <nearest.Provider
              store={nearest.make({
                ...nearest.store.getState(),
                entries: setup.nearestEntry ? [setup.nearestEntry] : [],
              })}
            >
              {setup.element ?? <FlightLogStrip />}
            </nearest.Provider>
          </panels.Provider>
        </gps.Provider>
      </flightLog.Provider>
    </ThemeContext.Provider>,
  );
  return { view, store, actions, gpsStore };
}

const label = (view: Rendered, testID: string) => view.byTestId(testID).props.accessibilityLabel;
const valueOf = (view: Rendered, name: string) => view.byLabel(name)[0]?.props.accessibilityValue?.text;
const lost: GpsData = { status: { kind: 'lost', ageSeconds: 12 }, failure: null };

describe('FlightLogStrip, the reference fixture (KPAO -> KOAK direct)', () => {
  it('shows the header, NEXT, NOW and no FLOWN', async () => {
    const { view } = await renderStrip();
    const text = view.text();
    for (const s of ['DIRECT KOAK', 'Next', 'direct', '9:12', 'KOAK', `14.9 NM${DOT}349\u00B0${DOT}ETA 18:11`]) {
      expect(text).toContain(s);
    }
    for (const s of ['DIRECT', 'GS kt', '96', '296', '680', '+475', '4,000', 'Clear', '00:00:06'])
      expect(text).toContain(s);
    expect(text).not.toContain('Flown');
    expect(text).not.toContain('Plan a flight');
  });

  it('speaks the NEXT row as one element and hides its parts', async () => {
    const { view } = await renderStrip();
    expect(label(view, 'next-waypoint')).toBe(
      `NEXT KOAK${DOT}in 9 minutes 12 seconds${DOT}14.9 NM${DOT}349\u00B0${DOT}ETA 18:11`,
    );
    const hiddenTexts = view.all(
      (n) => n.props.accessibilityElementsHidden === true && typeof n.props.children === 'string',
    );
    expect(hiddenTexts.map((n) => n.props.children)).toEqual(['9:12', `14.9 NM${DOT}349\u00B0${DOT}ETA 18:11`]);
  });

  it('labels the readouts, the tape, the leg, Clear and the record control like the Swift', async () => {
    const { view } = await renderStrip();
    expect(valueOf(view, 'Ground speed')).toBe('96 knots');
    expect(valueOf(view, 'Track')).toBe('296 degrees true');
    expect(valueOf(view, 'Altitude')).toBe('680 feet, vertical speed +475 feet per minute');
    expect(valueOf(view, 'Altitude tape')).toBe('680 feet, climbing 475 feet per minute');
    expect(view.byLabel('Leg DIRECT to KOAK')).toHaveLength(1);
    expect(label(view, 'active-navigation-bar')).toBe('Route DIRECT KOAK');
    const clear = view.byTestId('clear-direct-to');
    expect(clear.props.accessibilityLabel).toBe('Clear DIRECT KOAK');
    expect(clear.props.accessibilityRole).toBe('button');
    const record = view.byTestId('record-button');
    expect(record.props.accessibilityLabel).toBe('Stop recording');
    expect(record.props.accessibilityValue).toEqual({ text: 'Recording, 00:00:06' });
    expect(valueOf(view, 'Audio level')).toBe('0 of 5');
    expect(view.byTestId('flight-log-button').props.accessibilityLabel).toBe('Flight log');
  });

  it('raises Clear, Log and Rec; Search opens the search column', async () => {
    const { view, actions } = await renderStrip();
    await press(view.byTestId('clear-direct-to'));
    await press(view.byTestId('flight-log-button'));
    await press(view.byTestId('record-button'));
    expect(actions.clear).toHaveBeenCalledTimes(1);
    expect(actions.openLog).toHaveBeenCalledTimes(1);
    expect(actions.record).toHaveBeenCalledTimes(1);
    await press(view.byLabel('Search airports')[0]);
    expect(appStore.getState().stripColumn).toBe('search');
    appStore.setState({ stripColumn: 'log' });
  });

  it('re-renders when the store changes', async () => {
    const { view, store } = await renderStrip();
    await act(async () => store.setState({ groundSpeed: 121, estimatedTimeEnroute: 676, distanceToNext: 18.4 }));
    expect(view.text()).toContain('121');
    expect(view.text()).toContain('11:16');
    expect(view.text()).toContain('18.4 NM');
    expect(view.text()).not.toContain('9:12');
  });
});

describe('FlightLogStrip, GPS states', () => {
  it('a lost fix dashes NEXT, greys and announces the readouts as stale', async () => {
    const { view } = await renderStrip({ gps: lost });
    const text = view.text();
    expect(text).toContain(`--- NM${DOT}---\u00B0${DOT}ETA ---`);
    expect(text).not.toContain('9:12');
    expect(label(view, 'next-waypoint')).toBe(`NEXT KOAK${DOT}distance, bearing and ETA unavailable, stale`);
    expect(valueOf(view, 'Ground speed')).toBe('96 knots, stale');
    expect(valueOf(view, 'Altitude')).toBe('680 feet, vertical speed +475 feet per minute, stale');
    expect(valueOf(view, 'Altitude tape')).toBe('No current altitude');
    const greys = view.all((n) => n.props.children === '96' && n.props.style);
    expect(JSON.stringify(greys[0].props.style)).toContain(Day.inkSecondary);
  });

  it('no fix at all dashes the readouts', async () => {
    const { view } = await renderStrip({ data: { gpsAvailable: false, hasPosition: false } });
    expect(valueOf(view, 'Ground speed')).toBe('--- knots');
    expect(valueOf(view, 'Track')).toBe('--- degrees true');
    expect(valueOf(view, 'Altitude')).toBe('--- feet, vertical speed --- feet per minute');
  });

  it('a fix without altitude dashes ALT and VS only', async () => {
    const { view } = await renderStrip({ data: { hasAltitude: false } });
    expect(valueOf(view, 'Ground speed')).toBe('96 knots');
    expect(valueOf(view, 'Altitude')).toBe('--- feet, vertical speed --- feet per minute, stale');
  });

  it('a lost fix with a failure shows the GPS notice; Open Settings only for a denial', async () => {
    const { view, actions } = await renderStrip({ gps: { ...lost, failure: 'authorizationDenied' } });
    expect(view.byTestId('gps-failure-notice')).toBeTruthy();
    await press(view.byTestId('gps-open-settings'));
    expect(actions.openSettings).toHaveBeenCalledTimes(1);
    const restricted = await renderStrip({ gps: { ...lost, failure: 'authorizationRestricted' } });
    expect(restricted.view.all((n) => n.props.testID === 'gps-open-settings')).toHaveLength(0);
    const fresh = await renderStrip({ gps: { status: { kind: 'ok' }, failure: 'authorizationDenied' } });
    expect(fresh.view.all((n) => n.props.testID === 'gps-failure-notice')).toHaveLength(0);
  });

  it('below 30 kt the time-to is quiet: the ident is the big element', async () => {
    const { view } = await renderStrip({ data: { groundSpeed: 20 } });
    expect(view.text()).toContain('---');
    expect(view.text()).not.toContain('9:12');
    expect(label(view, 'next-waypoint')).toBe(`NEXT KOAK${DOT}14.9 NM${DOT}349\u00B0`);
  });
});

describe('FlightLogStrip, no navigation', () => {
  it('shows No route, the nearest airport and Plan a flight; no Clear', async () => {
    const entry = {
      airport: makeAirport({
        icao: 'KPAO',
        name: 'Palo Alto',
        latitude: 37.46,
        longitude: -122.11,
        elevation: 4,
        type: 'airport',
        ownership: 'public',
      }),
      distance: 2.04,
      bearing: 116,
    };
    const { view, actions } = await renderStrip({ data: noNavigationFixture, nearestEntry: entry });
    expect(view.byTestId('no-route').props.accessibilityLabel).toBe('No route');
    expect(view.text()).toContain(`NRST KPAO 2.0 NM${DOT}116\u00B0`);
    expect(view.all((n) => n.props.testID === 'clear-direct-to')).toHaveLength(0);
    expect(view.text()).not.toContain('direct');
    await press(view.byTestId('plan-a-flight'));
    expect(actions.openLog).toHaveBeenCalledTimes(1);
  });

  it('says why there is no nearest airport', async () => {
    expect((await renderStrip({ data: noNavigationFixture })).view.text()).toContain('No landable airport in range');
    const noGps = await renderStrip({ data: { ...noNavigationFixture, gpsAvailable: false } });
    expect(noGps.view.text()).toContain('Waiting for GPS');
  });
});

describe('FlightLogStrip, a stale fix on a route (Q7, owner-approved deviation from Swift)', () => {
  const entry = {
    airport: makeAirport({
      icao: 'KPAO',
      name: 'Palo Alto',
      latitude: 37.46,
      longitude: -122.11,
      elevation: 4,
      type: 'airport',
      ownership: 'public',
    }),
    distance: 2.04,
    bearing: 116,
  };

  it('shows leg progress, cautions and the NEXT nearest row as current only with a fix', async () => {
    const { view } = await renderStrip({ data: routeFixture });
    expect(view.text()).toContain('7.5 / 12.0 NM');
    expect(view.text()).toContain('1.2 NM RIGHT OF ROUTE');
    expect(view.all((n) => n.props.testID === 'israel-route-stale')).toHaveLength(0);
  });

  it('a lost fix dashes the progress, hides the cautions behind one stale marker and speaks stale', async () => {
    const { view } = await renderStrip({ data: routeFixture, gps: lost });
    expect(view.text()).toContain('--- / 12.0 NM');
    expect(view.text()).not.toContain('7.5 / 12.0');
    expect(valueOf(view, 'Leg progress')).toBe('12.0 nautical mile leg, progress unavailable, stale');
    expect(view.text()).not.toContain('RIGHT OF ROUTE');
    expect(view.text()).not.toContain('FLY 2500');
    expect(label(view, 'israel-route-stale')).toBe('Route cautions unavailable, stale');
  });

  it('a lost fix dashes the NEXT nearest row and speaks stale; a degraded fix is still a fix', async () => {
    const { view } = await renderStrip({ data: noNavigationFixture, nearestEntry: entry, gps: lost });
    expect(view.text()).toContain(`NRST --- --- NM${DOT}---\u00B0`);
    expect(view.text()).not.toContain('KPAO');
    expect(view.byLabel('Nearest airport unavailable, stale')).toHaveLength(1);
    const degraded: GpsData = {
      status: { kind: 'degraded', reason: { kind: 'poorHorizontalAccuracy', meters: 80 } },
      failure: null,
    };
    const d = await renderStrip({ data: noNavigationFixture, nearestEntry: entry, gps: degraded });
    expect(d.view.text()).toContain(`NRST KPAO 2.0 NM${DOT}116\u00B0`);
  });

  it('everything returns when the fix recovers', async () => {
    const route = await renderStrip({ data: routeFixture, gps: lost });
    await act(async () => route.gpsStore.setState({ status: { kind: 'ok' } }));
    expect(route.view.text()).toContain('7.5 / 12.0 NM');
    expect(route.view.text()).toContain('1.2 NM RIGHT OF ROUTE');
    expect(valueOf(route.view, 'Leg progress')).toBe('7.5 of 12.0 nautical miles flown');
    expect(route.view.all((n) => n.props.testID === 'israel-route-stale')).toHaveLength(0);
    const near = await renderStrip({ data: noNavigationFixture, nearestEntry: entry, gps: lost });
    await act(async () => near.gpsStore.setState({ status: { kind: 'ok' } }));
    expect(near.view.text()).toContain(`NRST KPAO 2.0 NM${DOT}116\u00B0`);
  });
});

describe('FlightLogStrip, an Israel CVFR route', () => {
  it('titles the route, lists the later points and the flown ones', async () => {
    const { view } = await renderStrip({ data: routeFixture });
    const text = view.text();
    expect(label(view, 'active-navigation-bar')).toBe(`Route \u2192 BAZRA 2500 FT${DOT}LLIB`);
    expect(text).toContain('route');
    // Next point: 3:00, ETA from route following in Israel time.
    expect(label(view, 'israel-route-next-point')).toBe(
      `NEXT BAZRA${DOT}in 3 minutes 0 seconds${DOT}4.5 NM${DOT}120\u00B0${DOT}ETA 15:41`,
    );
    // Later points at ground speed: 180 s + 15 NM / 90 kt, then + 18 NM.
    expect(text).toContain('13:00');
    expect(text).toContain('25:00');
    expect(text).toContain(`3000 FT${DOT}15.0 NM`);
    expect(view.byLabel('Then NATAN, 3000 feet')[0].props.accessibilityValue).toEqual({
      text: 'in 13 minutes 0 seconds',
    });
    expect(view.byLabel('Departed LLHZ')).toHaveLength(1);
    expect(view.byLabel('Passed MIDAA')).toHaveLength(1);
    expect(text).toContain('DEP');
  });

  it('shows the leg, its progress, the cautions and the leg controls', async () => {
    const { view, actions } = await renderStrip({ data: routeFixture });
    expect(label(view, 'israel-route-leg')).toBe('Leg MIDAA to BAZRA');
    expect(label(view, 'israel-route-altitude')).toBe('Published altitude 2500 feet');
    expect(valueOf(view, 'Leg progress')).toBe('7.5 of 12.0 nautical miles flown');
    expect(view.text()).toContain('7.5 / 12.0 NM');
    expect(view.text()).toContain('1.2 NM RIGHT OF ROUTE');
    expect(view.text()).toContain(`350 FT LOW${DOT}FLY 2500`);
    await press(view.byTestId('israel-route-previous'));
    await press(view.byTestId('israel-route-next'));
    expect(actions.sequenceRoute).toHaveBeenNthCalledWith(1, false);
    expect(actions.sequenceRoute).toHaveBeenNthCalledWith(2, true);
    expect(view.byTestId('clear-direct-to').props.accessibilityLabel).toBe(`Clear \u2192 BAZRA 2500 FT${DOT}LLIB`);
    expect(view.byTestId('israel-briefing-button').props.accessibilityLabel).toBe('NOTAM briefing');
  });

  it('disables Prev on the first leg and Next on the last', async () => {
    const first = { ...routeFixture.activeRoute!, currentLeg: 0 };
    const { view, actions } = await renderStrip({ data: { ...routeFixture, activeRoute: first } });
    expect(view.byTestId('israel-route-previous').props.accessibilityState).toEqual({ disabled: true });
    await press(view.byTestId('israel-route-previous'));
    expect(actions.sequenceRoute).not.toHaveBeenCalled();
    const last = await renderStrip({ data: { ...routeFixture, activeRoute: { ...first, currentLeg: 3 } } });
    expect(last.view.byTestId('israel-route-next').props.accessibilityState).toEqual({ disabled: true });
  });

  it('a US plan shows its departure in FLOWN and PPOS-less leg line', async () => {
    const plan = { ...noNavigationFixture, activeFlightPlan: true, planDeparture: 'KPAO', planDestination: 'KSQL' };
    const { view } = await renderStrip({ data: { ...plan, estimatedTimeEnroute: 300 } });
    expect(view.byLabel('Departed KPAO')).toHaveLength(1);
    expect(view.byLabel('Leg KPAO to KSQL')).toHaveLength(1);
    expect(view.text()).toContain('plan');
  });
});

describe('FlightLogStrip, predictions in NEXT (stage 2)', () => {
  it('the soonest event is the amber block; later rows and the tape follow', async () => {
    const { view } = await renderStrip({ data: { predictedEvents }, panels: { showsPredictions: true } });
    expect(label(view, 'next-predicted-event')).toBe(
      'Caution, Class B floor 3,000 feet in 1 minute 50 seconds, if you hold track 312 and climb 300 feet per minute',
    );
    expect(view.text()).toContain('If you hold 312\u00B0 and +300 fpm');
    expect(view.all((n) => n.props.testID === 'next-predicted-event-row')).toHaveLength(2);
    expect(label(view, 'next-waypoint')).toContain('NEXT KOAK');
    expect(valueOf(view, 'Altitude tape')).toBe(
      '680 feet, climbing 475 feet per minute, Class B floor 3,000 feet in 1 minute 50 seconds',
    );
    expect(view.text()).toContain('B floor 3,000');
  });

  it('caps the later rows at 3 and counts the rest to the destination', async () => {
    const { view } = await renderStrip({
      data: { ...routeFixture, predictedEvents },
      panels: { showsPredictions: true },
    });
    expect(view.text()).toContain('+2 more to LLIB');
    expect(view.byTestId('next-more-points')).toBeTruthy();
  });

  it('shows no predictions with the toggle off or a stale fix', async () => {
    const off = await renderStrip({ data: { predictedEvents } });
    expect(off.view.all((n) => n.props.testID === 'next-predicted-event')).toHaveLength(0);
    const stale = await renderStrip({ data: { predictedEvents }, panels: { showsPredictions: true }, gps: lost });
    expect(stale.view.all((n) => n.props.testID === 'next-predicted-event')).toHaveLength(0);
  });

  it('night: no fill, the block on the active cell with an amber rule', async () => {
    const { view } = await renderStrip({ data: { predictedEvents }, panels: { showsPredictions: true }, theme: Night });
    const block = view.byTestId('next-predicted-event');
    expect(JSON.stringify(block.props.style)).toContain(Night.activeCell);
  });
});

describe('FlightLogStrip, panels hidden', () => {
  it('instruments off: no NOW, the header carries Clear', async () => {
    const { view, actions } = await renderStrip({ panels: { showsInstruments: false } });
    expect(view.byLabel('Ground speed')).toHaveLength(0);
    const clear = view.byTestId('clear-direct-to');
    expect(clear.props.accessibilityLabel).toBe('Clear DIRECT KOAK');
    await press(clear);
    expect(actions.clear).toHaveBeenCalledTimes(1);
  });

  it('flight log off: the header carries the next time-to', async () => {
    const { view } = await renderStrip({ element: <FlightLogHeader showsNextTime /> });
    expect(view.text()).toContain(`DIRECT KOAK${DOT}9:12`);
    expect(label(view, 'active-navigation-bar')).toBe('Route DIRECT KOAK, next in 9 minutes 12 seconds');
    const stale = await renderStrip({ element: <FlightLogHeader showsNextTime />, gps: lost });
    expect(stale.view.text()).not.toContain('9:12');
  });

  it('flight log off with predictions: the soonest event replaces the time-to', async () => {
    const { view } = await renderStrip({
      element: <FlightLogHeader showsNextTime />,
      data: { predictedEvents },
      panels: { showsPredictions: true },
    });
    expect(view.text()).toContain(`B floor 3,000${DOT}1:50`);
    expect(label(view, 'active-navigation-bar')).toBe(
      'Route DIRECT KOAK, Caution, Class B floor 3,000 feet in 1 minute 50 seconds, if you hold track 312 and climb 300 feet per minute',
    );
  });
});

describe('FlightLogStrip, notices', () => {
  it('stacks the notices that apply above NEXT', async () => {
    const { view } = await renderStrip({
      data: {
        isOffline: true,
        airspaceCheckUnavailable: true,
        israelAlertsSuspended: true,
        recording: null,
        recordingUnavailable: true,
      },
    });
    for (const id of [
      'airspace-check-unavailable',
      'israel-alerts-suspended',
      'offline-notice',
      'recording-unavailable',
    ]) {
      expect(view.byTestId(id)).toBeTruthy();
    }
    expect(view.text()).toContain('Offline, using cached data');
    expect(view.all((n) => n.props.testID === 'record-button')).toHaveLength(0);
  });

  it('renders no notices when all is well', async () => {
    const { view } = await renderStrip();
    expect(view.text()).not.toContain('Offline');
    expect(view.all((n) => n.props.testID === 'gps-failure-notice')).toHaveLength(0);
  });
});

describe('FlightLogStrip, review fixes', () => {
  const textNode = (view: Rendered, text: string) => view.all((n) => n.props.children === text)[0];
  const fit = (node: ReturnType<typeof textNode>) => ({
    numberOfLines: node.props.numberOfLines,
    adjustsFontSizeToFit: node.props.adjustsFontSizeToFit,
    minimumFontScale: node.props.minimumFontScale,
  });

  it('NEXT texts shrink to fit with the Swift minimum scale factors', async () => {
    const { view } = await renderStrip();
    expect(fit(textNode(view, '9:12'))).toEqual({
      numberOfLines: 1,
      adjustsFontSizeToFit: true,
      minimumFontScale: 0.3,
    });
    expect(fit(view.byTestId('next-waypoint'))).toEqual({
      numberOfLines: 1,
      adjustsFontSizeToFit: true,
      minimumFontScale: 0.6,
    });
    const quiet = await renderStrip({ data: { groundSpeed: 20 } });
    expect(fit(quiet.view.byTestId('next-waypoint')).minimumFontScale).toBe(0.3);
  });

  it('the event block and later rows shrink to fit like the Swift', async () => {
    const { view } = await renderStrip({
      data: { ...routeFixture, predictedEvents },
      panels: { showsPredictions: true },
    });
    expect(fit(textNode(view, '1:50'))).toEqual({
      numberOfLines: 1,
      adjustsFontSizeToFit: true,
      minimumFontScale: 0.3,
    });
    expect(fit(textNode(view, 'B floor 3,000'))).toEqual({
      numberOfLines: 1,
      adjustsFontSizeToFit: true,
      minimumFontScale: 0.5,
    });
    expect(fit(textNode(view, '3:00'))).toEqual({
      numberOfLines: 1,
      adjustsFontSizeToFit: true,
      minimumFontScale: 0.5,
    });
    expect(fit(textNode(view, 'BAZRA'))).toEqual({
      numberOfLines: 1,
      adjustsFontSizeToFit: true,
      minimumFontScale: 0.6,
    });
  });

  it('later rows of the same volume and kind do not share a React key', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const twice = [
        predictedEvents[0],
        { ...predictedEvents[1], secondsAhead: 200 },
        { ...predictedEvents[1], secondsAhead: 300 },
      ];
      const { view } = await renderStrip({ data: { predictedEvents: twice }, panels: { showsPredictions: true } });
      expect(view.all((n) => n.props.testID === 'next-predicted-event-row')).toHaveLength(2);
      expect(errors.mock.calls.flat().join(' ')).not.toContain('same key');
    } finally {
      errors.mockRestore();
    }
  });

  describe('notices + NEXT: natural height, scrolling only when too tall', () => {
    const layout = (height: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height } } });
    const box = (view: Rendered) => view.byTestId('flight-log-above-now');
    const content = (view: Rendered) => view.byTestId('flight-log-above-now-content');
    const scrolls = (view: Rendered) => box(view).type !== 'View';

    it('a content layout before the box is measured does not mount the scroll view', async () => {
      const { view } = await renderStrip();
      await callHandler(content(view), 'onLayout', layout(500));
      expect(scrolls(view)).toBe(false);
    });

    it('fits: a View; taller than the box: a ScrollView', async () => {
      const { view } = await renderStrip();
      await callHandler(box(view), 'onLayout', layout(300));
      await callHandler(content(view), 'onLayout', layout(176.5));
      expect(scrolls(view)).toBe(false);
      await callHandler(content(view), 'onLayout', layout(420));
      expect(scrolls(view)).toBe(true);
    });
  });
});
