import { act } from 'react';
import type { TestInstance } from 'test-renderer';
import { callHandler, press, render } from '../../../tests/support/ui';
import { RECOVERED_NOTE } from '../../data/models';
import { ThemeContext } from '../Primitives';
import { Day } from '../tokens';
import { entry, flight, REFERENCE_LOG, REFERENCE_NOW_MS } from './fixtures';
import { LogStack } from './LogStack';
import { log, logActions, type LogActions, type LogData } from './store';

function setup(data: Partial<LogData> = {}) {
  const actions: { [K in keyof LogActions]: jest.Mock } = {
    openMap: jest.fn(),
    openSettings: jest.fn(),
    openPlanner: jest.fn(),
    addEntry: jest.fn(),
    openFlight: jest.fn(),
    openEntry: jest.fn(),
    deleteEntry: jest.fn(),
  };
  const store = log.make({ ...REFERENCE_LOG, ...data });
  const element = (
    <ThemeContext.Provider value={Day}>
      <log.Provider store={store}>
        <logActions.Provider store={logActions.make(actions)}>
          <LogStack />
        </logActions.Provider>
      </log.Provider>
    </ThemeContext.Provider>
  );
  return { actions, store, element };
}

const headerTexts = (nodes: TestInstance[]) => nodes.map((n) => n.children.join(''));
const styleOf = (node: TestInstance) => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));
const idle: Partial<LogData> = { recording: { kind: 'idle' } };
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
    const plan = view.byTestId('log-plan-flight');
    expect(plan.props.accessibilityLabel).toBe('Plan a flight');
    expect(plan.props.accessibilityHint).toBe('Opens the flight planner and saved plans');
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

describe('LogStack: Next and Now', () => {
  it('hides Now when not recording and not navigating', async () => {
    const view = await render(setup(idle).element);
    expect(headerTexts(view.byRole('header'))).toEqual(['Log', 'Next', 'Flown', 'Totals']);
    expect(view.all((n) => n.props.testID === 'log-now-row')).toHaveLength(0);
  });

  it('shows the active plan above Plan a flight, both opening the planner', async () => {
    const { element, actions } = setup({ ...idle, activePlanCodes: ['LLHZ', 'ZOMET', 'LLIB'] });
    const view = await render(element);
    expect(view.text()).toContain('Active plan LLHZ \u25B8 ZOMET \u25B8 LLIB Plan a flight');
    const plan = view.byTestId('log-active-plan');
    expect(plan.props.accessibilityLabel).toBe('Active plan, LLHZ to ZOMET to LLIB');
    expect(plan.props.accessibilityHint).toBe('Opens the flight planner');
    await press(plan);
    expect(actions.openPlanner).toHaveBeenCalledTimes(1);
  });

  it('navigating without recording: the route, next waypoint and ETE, no REC', async () => {
    const fix = {
      timestampMs: REFERENCE_NOW_MS - 1000,
      horizontalAccuracyM: 5,
      verticalAccuracyM: 5,
      isStationary: false,
    };
    const view = await render(
      setup({
        ...idle,
        hasActiveNavigation: true,
        activePlanCodes: ['LLHZ', 'LLIB'],
        nextIdent: 'LLIB',
        estimatedTimeEnrouteSeconds: 65 * 60,
        ownshipFix: fix,
      }).element,
    );
    expect(view.text()).toContain('Now LLHZ \u25B8 LLIB Next LLIB 1:05 Flown');
    expect(view.text()).not.toContain('REC');
    expect(view.byTestId('log-now-row').props.accessibilityLabel).toBe(
      'Now, LLHZ to LLIB, next LLIB, time to next 1h 5m',
    );
  });

  it('a stale fix hides the ETE and greys it', async () => {
    const fix = {
      timestampMs: REFERENCE_NOW_MS - 60_000,
      horizontalAccuracyM: 5,
      verticalAccuracyM: 5,
      isStationary: false,
    };
    const view = await render(
      setup({ directToIcao: 'KOAK', nextIdent: 'KOAK', estimatedTimeEnrouteSeconds: 600, ownshipFix: fix }).element,
    );
    expect(view.text()).toContain('Now Direct KOAK REC 0:00:05 Next KOAK ETE ---');
    const ete = view.all((n) => n.type === 'Text' && n.children.join('') === 'ETE ---')[0];
    expect(styleOf(ete).color).toBe(Day.inkSecondary);
    expect(view.byTestId('log-now-row').props.accessibilityLabel).toBe(
      'Now, Direct KOAK, REC 0:00:05, next KOAK, time to next unavailable',
    );
  });

  it('countdown, paused and stopping texts', async () => {
    const { element, store } = setup({ recording: { kind: 'countdown', remaining: 3 } });
    const view = await render(element);
    expect(view.text()).toContain('REC in 3 s');
    await act(async () => store.setState({ recording: { kind: 'paused' } }));
    expect(view.text()).toContain('REC paused');
    await act(async () => store.setState({ recording: { kind: 'stopping' } }));
    expect(view.text()).toContain('REC stopping');
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
    const { element, actions } = setup({ ...idle, flights: [recorded], entries: [draft] });
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
    const { element, actions } = setup({ ...idle, flights: [recorded], entries: [draft] });
    const view = await render(element);
    const row = view.byTestId('log-flight-row');
    expect(row.props.accessibilityActions).toEqual([{ name: 'delete', label: 'Delete draft' }]);
    await callHandler(row, 'onAccessibilityAction', { nativeEvent: { actionName: 'delete' } });
    expect(actions.deleteEntry).toHaveBeenCalledWith('e1');
  });

  it('a signed entry offers a read-only Logbook button and no delete', async () => {
    const signed = { ...draft, isConfirmed: true };
    const { element, actions } = setup({ ...idle, flights: [recorded], entries: [signed] });
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
    const view = await render(setup({ ...idle, flights: [recovered] }).element);
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
    const { element, actions } = setup({ ...idle, entries: [manualSigned, manualDraft] });
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
    const view = await render(setup({ ...idle, flights: [...flights].reverse(), entries }).element);
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
      setup({ ...idle, flights: [long], activePlanCodes: ['AAAA', 'BBBBB', 'CCCCC', 'DDDDD'] }).element,
    );
    const route = view.all(
      (n) => n.type === 'Text' && n.children.join('') === 'VERYLONGIDENT \u25B8 ANOTHERLONGIDENT',
    )[0];
    expect(route.props.numberOfLines).toBe(1);
    expect(route.props.adjustsFontSizeToFit).toBe(true);
    expect(route.props.minimumFontScale).toBe(0.6);
    const plan = view.all((n) => n.type === 'Text' && n.children.join('').startsWith('AAAA'))[0];
    expect(plan.props.numberOfLines).toBe(2);
  });
});
