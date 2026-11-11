import { act } from 'react';
import type { TestInstance } from 'test-renderer';
import { callHandler, press, render } from '../../../tests/support/ui';
import { RECOVERED_NOTE } from '../../data/models';
import type { RecordingStatus } from '../../domain/recording/recordingCoordinator';
import { israelRoute } from '../flightLog/fixtures';
import { flightLog, type FlightLogData } from '../flightLog/store';
import { ThemeContext } from '../Primitives';
import { Day, Night, type Theme } from '../tokens';
import { NowProvider } from './clock';
import { entry, flight, REFERENCE_FLIGHT_LOG, REFERENCE_LOG, REFERENCE_NOW_MS } from './fixtures';
import { LogStack } from './LogStack';
import { log, logActions, type LogActions, type LogData } from './store';

interface Setup {
  log?: Partial<LogData>;
  flight?: Partial<FlightLogData>;
  /** A fixed clock; null lets the Now row's own clock tick. */
  now?: number | null;
  theme?: Theme;
}

function setup({ log: logData = {}, flight: flightData = {}, now = REFERENCE_NOW_MS, theme = Day }: Setup = {}) {
  const actions: { [K in keyof LogActions]: jest.Mock } = {
    openMap: jest.fn(),
    openSettings: jest.fn(),
    openPlanner: jest.fn(),
    addEntry: jest.fn(),
    openFlight: jest.fn(),
    openEntry: jest.fn(),
    deleteEntry: jest.fn(),
  };
  const logStore = log.make({ ...REFERENCE_LOG, ...logData });
  const flightStore = flightLog.make({ ...REFERENCE_FLIGHT_LOG, ...flightData });
  const stack = (
    <ThemeContext.Provider value={theme}>
      <flightLog.Provider store={flightStore}>
        <log.Provider store={logStore}>
          <logActions.Provider store={logActions.make(actions)}>
            <LogStack />
          </logActions.Provider>
        </log.Provider>
      </flightLog.Provider>
    </ThemeContext.Provider>
  );
  const element = now == null ? stack : <NowProvider value={now}>{stack}</NowProvider>;
  return { actions, logStore, flightStore, element };
}

const headerTexts = (nodes: TestInstance[]) => nodes.map((n) => n.children.join(''));
const styleOf = (node: TestInstance) => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));
const recording = (status: RecordingStatus, elapsedSeconds = 5): Partial<FlightLogData> => ({
  recording: { status, elapsedSeconds, levelDBFS: -160, microphoneDenied: false },
});
const idle = recording({ kind: 'idle' }, 0);
const freshFix = (atMs: number) => ({
  timestampMs: atMs - 1000,
  horizontalAccuracyM: 5,
  verticalAccuracyM: 5,
  isStationary: false,
});
/** A US direct plan to LLIB, 10 minutes out. */
const plan: Partial<FlightLogData> = {
  activeFlightPlan: true,
  planDeparture: 'LLHZ',
  planDestination: 'LLIB',
  estimatedTimeEnroute: 600,
};
const nov11 = new Date(2026, 10, 11, 16, 36).getTime();

describe('LogStack: the reference state (reference/ipad-log.png)', () => {
  it('shows the title, Next, Now with the REC time, the empty Flown state and the totals', async () => {
    const view = await render(setup().element);
    expect(view.text()).toBe(
      [
        'Log',
        'Next',
        'Plan a flight',
        'Now',
        'Flight',
        'REC 0:00:05',
        'Flown',
        'No flights yet',
        'Recordings from the map appear here. Plan a flight above, or add a logbook entry with +.',
        'Totals',
        '0 flights',
        '0.0 h',
      ].join(' '),
    );
  });

  it('marks the title and the four section labels as headers', async () => {
    const view = await render(setup().element);
    expect(headerTexts(view.byRole('header'))).toEqual(['Log', 'Next', 'Now', 'Flown', 'Totals']);
  });

  it('labels the controls like the Swift', async () => {
    const view = await render(setup().element);
    const map = view.byTestId('log-map-button');
    expect(map.props.accessibilityLabel).toBe('Back to map');
    expect(map.props.accessibilityRole).toBe('button');
    expect(view.byTestId('log-settings-link').props.accessibilityLabel).toBe('Settings');
    const planRow = view.byTestId('log-plan-flight');
    expect(planRow.props.accessibilityLabel).toBe('Plan a flight');
    expect(planRow.props.accessibilityHint).toBe('Opens the flight planner and saved plans');
    expect(view.byTestId('log-add-entry').props.accessibilityLabel).toBe('Add logbook entry');
    const now = view.byTestId('log-now-row');
    expect(now.props.accessibilityLabel).toBe('Now, Flight, REC 0:00:05');
    expect(now.props.accessibilityHint).toBe('Returns to the map');
    const totals = view.byTestId('log-totals');
    expect(totals.props.accessibilityLabel).toBe('Logbook total, 0 flights, 0.0 hours');
    expect(totals.props.accessible).toBe(true);
    expect(view.byTestId('log-flown-empty').props.accessible).toBe(true);
  });

  it('pins the section headers like a plain List', async () => {
    const view = await render(setup().element);
    expect(view.byTestId('log-list').props.stickyHeaderIndices).toEqual([0, 2, 4, 6]);
  });

  it('draws the Now route in the route colour', async () => {
    const view = await render(setup().element);
    const flightText = view.all((n) => n.type === 'Text' && n.children.join('') === 'Flight')[0];
    expect(styleOf(flightText).color).toBe(Day.route);
  });
});

describe('LogStack: glass toolbar buttons', () => {
  it('keep the reference fill by day and use the theme paper at night', async () => {
    const day = await render(setup().element);
    const dayMap = styleOf(day.byTestId('log-map-button'));
    expect(dayMap.backgroundColor).toBe('#F9FBFD');
    expect(dayMap.boxShadow).toBe('0px 8px 32px rgba(20, 25, 31, 0.09)');
    const night = await render(setup({ theme: Night }).element);
    for (const id of ['log-map-button', 'log-settings-link']) {
      const style = styleOf(night.byTestId(id));
      expect(style.backgroundColor).toBe(Night.paperSecondary);
      expect(style.boxShadow).toBe('0px 8px 32px rgba(0, 0, 0, 0.5)');
    }
  });
});

describe('LogStack: actions', () => {
  it.each([
    ['log-map-button', 'openMap'],
    ['log-settings-link', 'openSettings'],
    ['log-plan-flight', 'openPlanner'],
    ['log-add-entry', 'addEntry'],
    ['log-now-row', 'openMap'],
  ] as const)('%s calls %s', async (testID, action) => {
    const { element, actions } = setup();
    const view = await render(element);
    await press(view.byTestId(testID));
    expect(actions[action]).toHaveBeenCalledTimes(1);
  });

  it('default actions are no-ops', async () => {
    const view = await render(
      <ThemeContext.Provider value={Day}>
        <LogStack />
      </ThemeContext.Provider>,
    );
    await press(view.byTestId('log-plan-flight'));
    await press(view.byTestId('log-add-entry'));
    expect(view.text()).toContain('Plan a flight');
  });
});

describe('LogStack: Next and Now (from the shared flight log slice)', () => {
  it('hides Now when not recording and not navigating', async () => {
    const view = await render(setup({ flight: idle }).element);
    expect(headerTexts(view.byRole('header'))).toEqual(['Log', 'Next', 'Flown', 'Totals']);
    expect(view.all((n) => n.props.testID === 'log-now-row')).toHaveLength(0);
  });

  it('hides Now without a recorder and without navigation', async () => {
    const view = await render(setup({ flight: { recording: null } }).element);
    expect(view.all((n) => n.props.testID === 'log-now-row')).toHaveLength(0);
  });

  it('shows the active route above Plan a flight, both opening the planner', async () => {
    const { element, actions } = setup({ flight: { ...idle, activeFlightPlan: true, activeRoute: israelRoute } });
    const view = await render(element);
    const route = 'LLHZ \u25B8 MIDAA \u25B8 BAZRA \u25B8 NATAN \u25B8 LLIB';
    expect(view.text()).toContain(`Next Active plan ${route} Plan a flight Now ${route} Next BAZRA`);
    const active = view.byTestId('log-active-plan');
    expect(active.props.accessibilityLabel).toBe('Active plan, LLHZ to MIDAA to BAZRA to NATAN to LLIB');
    expect(active.props.accessibilityHint).toBe('Opens the flight planner');
    await press(active);
    expect(actions.openPlanner).toHaveBeenCalledTimes(1);
  });

  it('navigating without recording: the route, next waypoint and ETE, no REC', async () => {
    const view = await render(setup({ flight: { ...idle, ...plan, ownshipFix: freshFix(REFERENCE_NOW_MS) } }).element);
    expect(view.text()).toContain('Now LLHZ \u25B8 LLIB Next LLIB 0:10 Flown');
    expect(view.text()).not.toContain('REC');
    expect(view.byTestId('log-now-row').props.accessibilityLabel).toBe(
      'Now, LLHZ to LLIB, next LLIB, time to next 0h 10m',
    );
  });

  it('a stale fix hides the ETE and greys it', async () => {
    const view = await render(
      setup({
        flight: {
          directTo: 'KOAK',
          activeFlightPlan: true,
          estimatedTimeEnroute: 600,
          ownshipFix: freshFix(REFERENCE_NOW_MS - 60_000),
        },
      }).element,
    );
    expect(view.text()).toContain('Now Direct KOAK REC 0:00:05 Next KOAK ETE ---');
    const ete = view.all((n) => n.type === 'Text' && n.children.join('') === 'ETE ---')[0];
    expect(styleOf(ete).color).toBe(Day.inkSecondary);
    expect(view.byTestId('log-now-row').props.accessibilityLabel).toBe(
      'Now, Direct KOAK, REC 0:00:05, next KOAK, time to next unavailable',
    );
  });

  it('GPS unavailable hides the ETE even with a fresh fix', async () => {
    const view = await render(
      setup({ flight: { ...plan, gpsAvailable: false, ownshipFix: freshFix(REFERENCE_NOW_MS) } }).element,
    );
    expect(view.text()).toContain('Next LLIB ETE ---');
  });

  it('a non-finite ETE is dashed', async () => {
    const view = await render(
      setup({ flight: { ...plan, estimatedTimeEnroute: Infinity, ownshipFix: freshFix(REFERENCE_NOW_MS) } }).element,
    );
    expect(view.text()).toContain('Next LLIB ETE ---');
    expect(view.text()).not.toMatch(/Infinity|NaN/);
  });

  it('countdown, paused and stopping texts', async () => {
    const { element, flightStore } = setup({ flight: recording({ kind: 'countdown', remaining: 3 }) });
    const view = await render(element);
    expect(view.text()).toContain('REC in 3 s');
    await act(async () => flightStore.setState(recording({ kind: 'paused' })));
    expect(view.text()).toContain('REC paused');
    await act(async () => flightStore.setState(recording({ kind: 'stopping' })));
    expect(view.text()).toContain('REC stopping');
  });
});

describe('LogStack: the Now row clock (TimelineView every second)', () => {
  beforeEach(() => {
    // Only the interval and Date are faked; React's own scheduling stays real.
    jest.useFakeTimers({
      now: REFERENCE_NOW_MS,
      doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout'],
    });
  });
  afterEach(() => jest.useRealTimers());

  it('ages a fresh fix into "ETE ---" as the clock advances, without any store update', async () => {
    const { element } = setup({
      now: null,
      flight: { ...plan, ...idle, ownshipFix: { ...freshFix(REFERENCE_NOW_MS), timestampMs: REFERENCE_NOW_MS } },
    });
    const view = await render(element);
    expect(view.text()).toContain('Next LLIB 0:10');
    await act(async () => {
      jest.advanceTimersByTime(5000); // 5 s old: still fresh (stale after more than 5 s)
    });
    expect(view.text()).toContain('Next LLIB 0:10');
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(view.text()).toContain('Next LLIB ETE ---');
  });

  it('clears its interval on unmount', async () => {
    const view = await render(setup({ now: null }).element);
    expect(jest.getTimerCount()).toBe(1);
    await act(async () => view.unmount());
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a NowProvider fixes the clock: no interval runs', async () => {
    const view = await render(setup({ now: REFERENCE_NOW_MS }).element);
    expect(jest.getTimerCount()).toBe(0);
    await act(async () => view.unmount());
  });
});

describe('LogStack: Flown', () => {
  const recorded = flight({
    id: 'f1',
    startDate: nov11,
    departureICAO: 'KSQL',
    arrivalICAO: 'KOAK',
    durationSeconds: 2700,
  });
  const draft = entry({ id: 'e1', flightID: 'f1', date: nov11, durationSeconds: 2700 });

  it('a flight with an unsigned draft offers Sign; pressing it opens the entry, the row opens the flight', async () => {
    const { element, actions } = setup({ flight: idle, log: { flights: [recorded], entries: [draft] } });
    const view = await render(element);
    expect(view.text()).toContain('Nov 11, 2026 at 4:36 PM KSQL \u25B8 KOAK 0h 45m Draft, sign');
    expect(view.all((n) => n.props.testID === 'log-flown-empty')).toHaveLength(0);
    const row = view.byTestId('log-flight-row');
    expect(row.props.accessibilityLabel).toBe(
      'Flight, Nov 11, 2026 at 4:36 PM, KSQL to KOAK, block time 0h 45m, Logbook draft, not signed',
    );
    expect(row.props.accessibilityHint).toBe('Opens flight details, debrief and replay');
    const sign = view.byTestId('log-sign-draft');
    expect(sign.props.accessibilityLabel).toBe('Sign logbook draft, KSQL to KOAK');
    await press(sign);
    expect(actions.openEntry).toHaveBeenCalledWith('e1');
    await press(row);
    expect(actions.openFlight).toHaveBeenCalledWith('f1');
    expect(view.text()).toContain('1 flight 0.8 h 1 draft to sign');
  });

  it('the draft can be deleted through the row (swipe action, exposed as an accessibility action)', async () => {
    const { element, actions } = setup({ flight: idle, log: { flights: [recorded], entries: [draft] } });
    const view = await render(element);
    const row = view.byTestId('log-flight-row');
    expect(row.props.accessibilityActions).toEqual([{ name: 'delete', label: 'Delete draft' }]);
    await callHandler(row, 'onAccessibilityAction', { nativeEvent: { actionName: 'delete' } });
    expect(actions.deleteEntry).toHaveBeenCalledWith('e1');
  });

  it('a signed entry offers a read-only Logbook button and no delete', async () => {
    const signed = { ...draft, isConfirmed: true };
    const { element, actions } = setup({ flight: idle, log: { flights: [recorded], entries: [signed] } });
    const view = await render(element);
    expect(view.text()).toContain('KSQL \u25B8 KOAK 0h 45m Logbook');
    const review = view.byTestId('log-open-entry');
    expect(review.props.accessibilityLabel).toBe('Logbook entry, KSQL to KOAK');
    await press(review);
    expect(actions.openEntry).toHaveBeenCalledWith('e1');
    expect(view.byTestId('log-flight-row').props.accessibilityActions).toBeUndefined();
    expect(view.all((n) => n.props.testID === 'log-sign-draft')).toHaveLength(0);
  });

  it('a flight without an entry has no entry button; a health caution carries words', async () => {
    const recovered = { ...recorded, notes: RECOVERED_NOTE };
    const view = await render(setup({ flight: idle, log: { flights: [recovered] } }).element);
    expect(view.text()).toContain('KSQL \u25B8 KOAK Recovered 0h 45m');
    expect(view.all((n) => n.props.testID === 'log-sign-draft' || n.props.testID === 'log-open-entry')).toHaveLength(0);
    expect(view.byTestId('log-flight-row').props.accessibilityLabel).toContain('Caution, Recovered');
  });

  it('manual entries: draft and signed rows, open and delete', async () => {
    const manualDraft = entry({
      id: 'm1',
      date: nov11,
      departureICAO: 'LLHZ',
      arrivalICAO: 'LLIB',
      durationSeconds: 3600,
    });
    const manualSigned = entry({ id: 'm2', date: nov11 - 86_400_000, aircraftType: 'C172', isConfirmed: true });
    const { element, actions } = setup({ flight: idle, log: { entries: [manualSigned, manualDraft] } });
    const view = await render(element);
    const rows = view.all((n) => n.props.testID === 'log-entry-row');
    expect(rows.map((r) => r.props.accessibilityLabel)).toEqual([
      'Logbook entry, Nov 11, 2026, LLHZ to LLIB, time 1h 0m, aircraft not set, draft, not signed',
      'Logbook entry, Nov 10, 2026, unknown to unknown, time 0s, C172, signed',
    ]);
    expect(rows[0].props.accessibilityHint).toBe('Opens the entry to edit and sign');
    expect(rows[1].props.accessibilityHint).toBe('Opens the signed entry');
    expect(view.text()).toContain('Nov 11, 2026 LLHZ \u25B8 LLIB Draft, sign 1h 0m Aircraft not set');
    expect(view.text()).toContain('Nov 10, 2026 --- \u25B8 --- Signed 0s C172');
    await press(rows[1]);
    expect(actions.openEntry).toHaveBeenCalledWith('m2');
    expect(rows[0].props.accessibilityActions).toEqual([{ name: 'delete', label: 'Delete' }]);
    expect(rows[1].props.accessibilityActions).toBeUndefined();
    await callHandler(rows[0], 'onAccessibilityAction', { nativeEvent: { actionName: 'delete' } });
    expect(actions.deleteEntry).toHaveBeenCalledWith('m1');
  });

  it('many flights scroll, newest first, with totals over every entry', async () => {
    const flights = Array.from({ length: 30 }, (_, i) =>
      flight({ id: `f${i}`, startDate: nov11 - i * 86_400_000, departureICAO: `K${i}`, durationSeconds: 3600 }),
    );
    const entries = flights.map((f) =>
      entry({ flightID: f.id, date: f.startDate, durationSeconds: 3600, isConfirmed: true }),
    );
    const view = await render(setup({ flight: idle, log: { flights: [...flights].reverse(), entries } }).element);
    const rows = view.all((n) => n.props.testID === 'log-flight-row');
    expect(rows).toHaveLength(30);
    expect(rows[0].props.accessibilityLabel).toContain('K0 to unknown');
    expect(rows[29].props.accessibilityLabel).toContain('K29 to unknown');
    expect(view.byTestId('log-list').type).toBe('RCTScrollView');
    expect(view.byTestId('log-totals').props.accessibilityLabel).toBe('Logbook total, 30 flights, 30.0 hours');
  });

  it('long route names stay on one line and shrink (minimumScaleFactor 0.6)', async () => {
    const long = flight({ startDate: nov11, departureICAO: 'VERYLONGIDENT', arrivalICAO: 'ANOTHERLONGIDENT' });
    const view = await render(
      setup({ flight: { ...idle, activeFlightPlan: true, activeRoute: israelRoute }, log: { flights: [long] } })
        .element,
    );
    const route = view.all(
      (n) => n.type === 'Text' && n.children.join('') === 'VERYLONGIDENT \u25B8 ANOTHERLONGIDENT',
    )[0];
    expect(route.props.numberOfLines).toBe(1);
    expect(route.props.adjustsFontSizeToFit).toBe(true);
    expect(route.props.minimumFontScale).toBe(0.6);
    const active = view.all((n) => n.type === 'Text' && n.children.join('').startsWith('LLHZ \u25B8 MIDAA'))[0];
    expect(active.props.numberOfLines).toBe(2);
  });
});

describe('LogStack: totals', () => {
  it('drafts follow a flexible spacer, so a wrapped draft count starts at the leading edge (no auto margin)', async () => {
    const view = await render(setup({ flight: idle, log: { entries: [entry({ durationSeconds: 1800 })] } }).element);
    const totals = view.byTestId('log-totals');
    const drafts = view.all((n) => n.type === 'Text' && n.children.join('') === '1 draft to sign')[0];
    expect(styleOf(drafts).marginLeft).toBeUndefined();
    const spacer = view.byTestId('log-totals-spacer');
    expect(styleOf(spacer)).toMatchObject({ flexGrow: 1 });
    expect(totals.children.map((c) => (typeof c === 'string' ? c : (c.props.testID ?? 'text')))).toEqual([
      'text',
      'text',
      'log-totals-spacer',
      'text',
    ]);
  });
});
