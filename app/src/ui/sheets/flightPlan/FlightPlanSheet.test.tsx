// Render tests for FlightPlanSheet (Views/Planning/FlightPlanView.swift) over the fixture store: the empty planner, airport
// search and pick, the summary card once both ends are picked, Save Plan / Clear, the saved plans list (load, delete,
// active mark, relative time), the restore on opening, the search failure and the missing-airport plan as Swift shows
// them (no dropdown, no summary), and the Israel planner in the Israel region.
import { act } from 'react';
import type * as ReactModule from 'react';
import type * as ReactNativeModule from 'react-native';
import { callHandler, press, render, type Rendered } from '../../../../tests/support/ui';
import { newFlightPlanRecord } from '../../../data/defaults';
import type { Region } from '../../../domain/core/region';
import { createFixturePlanStore } from '../israelPlan/fixture';
import { IsraelPlanProvider } from '../israelPlan/store';
import { FlightPlanSheet } from './FlightPlanSheet';
import {
  FIXTURE_NOW,
  FIXTURE_SAVED_PLANS,
  createFixtureFlightPlanStore,
  createUnavailableAviationDatabase,
  type FixtureOptions,
} from './fixture';
import { FlightPlanProvider, type FlightPlanDeps } from './store';

// The Israel planner's date picker is a native view (see IsraelFlightPlanSheet.test.tsx).
jest.mock('@expo/ui/community/datetime-picker', () => {
  const { createElement } = jest.requireActual<typeof ReactModule>('react');
  const { View } = jest.requireActual<typeof ReactNativeModule>('react-native');
  const DateTimePicker = (props: { testID?: string }) => createElement(View, { testID: props.testID });
  return { __esModule: true, default: DateTimePicker, DateTimePicker };
});

/** Let the store's async work (database, repository) settle and React re-render. */
const settle = () =>
  act(async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 0);
    await promise;
  });

async function mount(options: FixtureOptions = {}, overrides: Partial<FlightPlanDeps> = {}, region: Region = 'us') {
  const fixture = createFixtureFlightPlanStore(options, overrides);
  const view = await render(
    <FlightPlanProvider store={fixture.store}>
      <FlightPlanSheet region={region} />
    </FlightPlanProvider>,
  );
  await settle();
  return { ...fixture, view };
}

const field = (view: Rendered, name: 'departure' | 'destination') => view.byTestId(`fp-${name}`);
const type = async (view: Rendered, name: 'departure' | 'destination', text: string) => {
  await callHandler(field(view, name), 'onChangeText', text);
  await settle();
};
const has = (view: Rendered, testID: string) => view.all((n) => n.props?.testID === testID).length > 0;
const result = (view: Rendered, label: string) => {
  const found = view.byLabel(label);
  if (found.length === 0) throw new Error(`no result ${label}`);
  return found[0];
};

/** The result rows' labels ("ICAO, name"). */
const RESULT_LABELS = { KPAO: 'KPAO, Palo Alto', KSQL: 'KSQL, San Carlos', KOAK: 'KOAK, Oakland Intl' } as const;

async function pickRoute(view: Rendered, from: keyof typeof RESULT_LABELS, to: keyof typeof RESULT_LABELS) {
  await type(view, 'departure', from);
  await press(result(view, RESULT_LABELS[from]));
  await type(view, 'destination', to);
  await press(result(view, RESULT_LABELS[to]));
}

describe('FlightPlanSheet', () => {
  test('the empty planner: two airport fields and "No saved plans"', async () => {
    const { view } = await mount();
    expect(field(view, 'departure').props).toMatchObject({
      accessibilityLabel: 'Departure airport',
      placeholder: 'Search airport (ICAO, name, city)',
      value: '',
      autoCapitalize: 'characters',
      autoCorrect: false,
    });
    expect(field(view, 'destination').props.accessibilityLabel).toBe('Destination airport');
    const text = view.text();
    expect(text).toContain('Departure');
    expect(text).toContain('Destination');
    expect(text).toContain('No saved plans');
    expect(text).toContain('Pick a departure and destination above, then Save Plan.');
    expect(has(view, 'fp-summary')).toBe(false);
    expect(has(view, 'fp-save')).toBe(false);
    expect(has(view, 'fp-clear')).toBe(false);
  });

  test('typing two characters lists matching airports; one character hides the list', async () => {
    const { view } = await mount();
    await type(view, 'departure', 'K');
    expect(has(view, 'fp-departure-results')).toBe(false);

    await type(view, 'departure', 'KP');
    expect(view.byTestId('fp-departure-results')).toBeTruthy();
    expect(view.text()).toContain('KPAO Palo Alto');

    await type(view, 'departure', 'K');
    expect(has(view, 'fp-departure-results')).toBe(false);
  });

  test('a name search lists the airport under its field only', async () => {
    const { view } = await mount();
    await type(view, 'destination', 'Oakland');
    expect(view.byTestId('fp-destination-results')).toBeTruthy();
    expect(has(view, 'fp-departure-results')).toBe(false);
    expect(view.byLabel('KOAK, Oakland Intl')).toHaveLength(1);
  });

  test('picking a result fills the field with the ICAO and, as in Swift, reopens the list with that airport; one end shows no summary', async () => {
    // Swift bug kept (U4c.md): selectDeparture writes the query and `.onChange(of: departureQuery)` searches again.
    const { view, navigation } = await mount();
    await type(view, 'departure', 'Palo');
    await press(result(view, 'KPAO, Palo Alto'));
    await settle();
    expect(field(view, 'departure').props.value).toBe('KPAO');
    expect(view.byTestId('fp-departure-results')).toBeTruthy();
    expect(result(view, 'KPAO, Palo Alto')).toBeTruthy();
    expect(has(view, 'fp-summary')).toBe(false);
    expect(navigation.state.activeFlightPlan).toBe(false);
  });

  test('both ends show the summary card with distance, ETE and fuel at the active aircraft', async () => {
    const { view, navigation } = await mount();
    await pickRoute(view, 'KPAO', 'KSQL');
    const summary = view.byTestId('fp-summary');
    expect(summary).toBeTruthy();
    // 7.1 NM at 120 kt and 9 gph (FIXTURE_AIRCRAFT).
    expect(view.text()).toContain('KPAO KSQL 7.1 nm 0:03 ETE 0.5 gal');
    expect(view.byTestId('fp-save')).toBeTruthy();
    expect(view.byTestId('fp-clear')).toBeTruthy();
    expect(navigation.state.planDestination).toBe('KSQL');
  });

  test('without an active aircraft the card has no fuel and the ETE is at 100 kt', async () => {
    const { view } = await mount({ aircraft: [] });
    await pickRoute(view, 'KPAO', 'KOAK');
    expect(view.text()).toContain('KPAO KOAK 16.4 nm 0:09 ETE');
    expect(view.text()).not.toContain('gal');
  });

  test('Save Plan adds the plan to the saved list, marked active', async () => {
    const { view, plans } = await mount();
    await pickRoute(view, 'KPAO', 'KSQL');
    await press(view.byTestId('fp-save'));
    await settle();

    expect(has(view, 'fp-saved-empty')).toBe(false);
    const row = view.byTestId('fp-saved-plan-1');
    expect(row.props.accessibilityLabel).toBe('KPAO to KSQL, 7.1 nm, 0 seconds, Active plan');
    expect(row.props.accessibilityState).toEqual({ selected: true });
    expect(view.byTestId('fp-active-mark')).toBeTruthy();
    expect(await plans.list()).toHaveLength(1);
  });

  test('Clear empties the fields and the summary but keeps the saved plan', async () => {
    const { view, navigation } = await mount();
    await pickRoute(view, 'KPAO', 'KSQL');
    await press(view.byTestId('fp-save'));
    await settle();

    await press(view.byTestId('fp-clear'));
    expect(field(view, 'departure').props.value).toBe('');
    expect(field(view, 'destination').props.value).toBe('');
    expect(has(view, 'fp-summary')).toBe(false);
    expect(has(view, 'fp-active-mark')).toBe(false);
    expect(view.byTestId('fp-saved-plan-1').props.accessibilityState).toEqual({ selected: false });
    expect(navigation.state.activeFlightPlan).toBe(false);
  });

  test('opening the planner restores the most recent saved plan and lists both, newest first', async () => {
    const { view } = await mount({ plans: FIXTURE_SAVED_PLANS });
    expect(field(view, 'departure').props.value).toBe('KPAO');
    expect(field(view, 'destination').props.value).toBe('KSQL');
    expect(view.text()).toContain('KPAO KSQL 7.1 nm 0:03 ETE 0.5 gal');
    // Swift bug kept: writing the restored plan's ICAOs into the fields also reopens both lists.
    expect(view.byTestId('fp-departure-results')).toBeTruthy();
    expect(view.byTestId('fp-destination-results')).toBeTruthy();

    const rows = view.all((n) => typeof n.props?.testID === 'string' && n.props.testID.startsWith('fp-saved-plan-'));
    expect(rows.map((r) => r.props.testID)).toEqual(['fp-saved-plan-kpao-ksql', 'fp-saved-plan-ksql-kmod']);
    // Loading marks the restored plan used now; the other is 3 days old.
    expect(rows[0].props.accessibilityLabel).toBe('KPAO to KSQL, 7.1 nm, 0 seconds, Active plan');
    expect(rows[1].props.accessibilityLabel).toBe('KSQL to KMOD, 62.0 nm, 3 days');
    expect(view.text()).toContain('62.0 nm 3 days');
  });

  test('tapping a saved plan loads it', async () => {
    const { view, navigation } = await mount({ plans: FIXTURE_SAVED_PLANS });
    await press(view.byTestId('fp-saved-plan-ksql-kmod'));
    await settle();
    expect(field(view, 'departure').props.value).toBe('KSQL');
    expect(field(view, 'destination').props.value).toBe('KMOD');
    expect(view.text()).toContain('KSQL KMOD 62.0 nm 0:31 ETE 4.7 gal');
    expect(view.byTestId('fp-saved-plan-ksql-kmod').props.accessibilityState).toEqual({ selected: true });
    expect(navigation.state.planDestination).toBe('KMOD');
  });

  test('Delete removes a plan; deleting the active one clears the planner; the last one leaves "No saved plans"', async () => {
    const { view, navigation } = await mount({ plans: FIXTURE_SAVED_PLANS });
    await press(view.byTestId('fp-delete-plan-ksql-kmod'));
    await settle();
    expect(has(view, 'fp-saved-plan-ksql-kmod')).toBe(false);
    expect(view.byTestId('fp-summary')).toBeTruthy(); // the active plan stays

    expect(view.byTestId('fp-delete-plan-kpao-ksql').props.accessibilityLabel).toBe('Delete KPAO to KSQL');
    await press(view.byTestId('fp-delete-plan-kpao-ksql'));
    await settle();
    expect(has(view, 'fp-summary')).toBe(false);
    expect(field(view, 'departure').props.value).toBe('');
    expect(view.byTestId('fp-saved-empty')).toBeTruthy();
    expect(navigation.state.activeFlightPlan).toBe(false);
  });

  test('the row offers delete as an accessibility action (the swipe)', async () => {
    const { view } = await mount({ plans: FIXTURE_SAVED_PLANS });
    const row = view.byTestId('fp-saved-plan-ksql-kmod');
    expect(row.props.accessibilityActions).toEqual([{ name: 'delete', label: 'Delete' }]);
    await callHandler(row, 'onAccessibilityAction', { nativeEvent: { actionName: 'delete' } });
    await settle();
    expect(has(view, 'fp-saved-plan-ksql-kmod')).toBe(false);
  });

  test('the relative time ticks while the planner is open', async () => {
    jest.useFakeTimers({ now: FIXTURE_NOW });
    try {
      let now = FIXTURE_NOW;
      const old = newFlightPlanRecord({
        newId: () => 'old',
        departureICAO: 'KPAO',
        destinationICAO: 'KOAK',
        lastUsedAt: FIXTURE_NOW - 3600_000,
      });
      const recent = newFlightPlanRecord({
        newId: () => 'recent',
        departureICAO: 'KPAO',
        destinationICAO: 'KGONE',
        lastUsedAt: FIXTURE_NOW - 60_000,
      });
      const fixture = createFixtureFlightPlanStore({ plans: [old, recent] }, { now: () => now });
      const view = await render(
        <FlightPlanProvider store={fixture.store}>
          <FlightPlanSheet region="us" />
        </FlightPlanProvider>,
      );
      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });
      expect(view.byTestId('fp-saved-old').props.accessibilityLabel).toBe('KPAO to KOAK, 0.0 nm, 1 hour');
      now += 61_000;
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000);
      });
      expect(view.byTestId('fp-saved-old').props.accessibilityLabel).toBe('KPAO to KOAK, 0.0 nm, 1 hour, 1 minute');
    } finally {
      jest.useRealTimers();
    }
  });

  test('a failed search shows no list (the results are emptied, not kept)', async () => {
    const { view, store } = await mount({}, { database: createUnavailableAviationDatabase() });
    store.setState({ departureResults: [] });
    await type(view, 'departure', 'KPAO');
    expect(has(view, 'fp-departure-results')).toBe(false);
    expect(view.text()).toContain('No saved plans');
  });

  test('a saved plan whose airport left the database shows its ICAOs but no summary', async () => {
    const gone = newFlightPlanRecord({
      newId: () => 'gone',
      departureICAO: 'KPAO',
      destinationICAO: 'KGONE',
      lastUsedAt: FIXTURE_NOW,
    });
    const { view, navigation } = await mount({ plans: [gone] });
    expect(field(view, 'departure').props.value).toBe('KPAO');
    expect(field(view, 'destination').props.value).toBe('KGONE');
    expect(has(view, 'fp-summary')).toBe(false);
    expect(has(view, 'fp-save')).toBe(false);
    expect(view.byTestId('fp-saved-gone')).toBeTruthy();
    expect(navigation.state.activeFlightPlan).toBe(false);
  });

  test('in Israel the screen is the Israel planner', async () => {
    const store = createFixturePlanStore();
    const view = await render(
      <IsraelPlanProvider store={store}>
        <FlightPlanSheet region="israel" />
      </IsraelPlanProvider>,
    );
    expect(view.byTestId('il-flight-plan')).toBeTruthy();
    expect(has(view, 'flight-plan')).toBe(false);
  });
});
