// Render tests for IsraelFlightPlanSheet over the fixture store: the routed LLHZ -> LLIB plan (summary, legs, actions),
// the FPL preview whose E-mail button opens the draft to ais@iaa.gov.il (issue #39), pickers, via points, the network
// switch, the LSA section, the no-route banner, activation and clear.
import { act } from 'react';
import { callHandler, press, render } from '../../../../tests/support/ui';
import { newPilotProfile } from '../../../data/defaults';
import IsraelPlanRoute from '../../../app/israel-plan';
import { IsraelFlightPlanSheet } from './IsraelFlightPlanSheet';
import { FIXTURE_AIRCRAFT, FIXTURE_NOW, createFixturePlanStore, seedFixturePlan } from './fixture';
import { IsraelPlanProvider, type IsraelPlanDeps } from './store';

async function mount(overrides: Partial<IsraelPlanDeps> = {}, seeded = true) {
  const store = createFixturePlanStore(overrides);
  if (seeded) await seedFixturePlan(store);
  const opened: string[] = [];
  const shared: string[] = [];
  const view = await render(
    <IsraelPlanProvider store={store}>
      <IsraelFlightPlanSheet openURL={(url) => opened.push(url)} share={(text) => shared.push(text)} />
    </IsraelPlanProvider>,
  );
  return { store, view, opened, shared };
}

/** Let the store's async work (database, routing) settle and React re-render. */
const settle = () =>
  act(async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 0);
    await promise;
  });

describe('IsraelFlightPlanSheet', () => {
  test('the fixture plan shows the summary, the legs and the actions', async () => {
    const { view } = await mount();
    const summary = view.byTestId('il-summary');
    expect(summary).toBeTruthy();
    const text = view.text();
    expect(text).toContain('68.1 NM');
    expect(text).toContain('0:38'); // 68.1 NM at 105 kt
    expect(text).toContain('105 KT');
    expect(text).toContain('LLHZ \u2192 BAZRA');
    expect(text).toContain('800/1600');
    expect(text).toContain('AMNON \u2192 LLIB');
    expect(text).toContain('NOTAM closures were not checked'); // closures not checked without a feed (amber, not blocking)
    expect(view.byTestId('il-fpl-preview').props.accessibilityState).toEqual({ disabled: false });
    expect(view.byTestId('il-activate').props.accessibilityState).toEqual({ disabled: false });
  });

  test('without a pick there is no plan, only the briefing button and the disclaimer', async () => {
    const { view } = await mount({}, false);
    expect(view.all((n) => n.props?.testID === 'il-summary')).toHaveLength(0);
    expect(view.byTestId('il-notam-briefing')).toBeTruthy();
    expect(view.text()).toContain('Departure (local)');
    expect(view.text()).toContain('Thu 12.11.2026 09:00');
  });

  test('the E-mail button opens a draft to ais@iaa.gov.il, never to the pilot (issue #39)', async () => {
    const signals: string[] = [];
    const { view, opened, store } = await mount({
      signal: (name, parameters) => signals.push(`${name} ${parameters?.method ?? ''}`.trim()),
    });
    await press(view.byTestId('il-fpl-preview'));
    expect(view.byTestId('il-fpl-text').props.children).toBe(store.getState().fplText);
    expect(view.text()).toContain('File by phone or by e-mail to ais@iaa.gov.il');
    await press(view.byTestId('il-fpl-email'));
    expect(opened).toHaveLength(1);
    const url = new URL(opened[0]);
    expect(url.protocol).toBe('mailto:');
    expect(url.pathname).toBe('ais@iaa.gov.il');
    expect(url.searchParams.get('subject')).toBe('FPL 4XCXA');
    expect(opened[0]).not.toContain('pilot@example.com');
    expect(opened[0]).not.toContain(encodeURIComponent('pilot@example.com'));
    expect(signals).toEqual(['Israel.fplShared email']);
  });

  test('Share sends the message and the Hebrew summary', async () => {
    const { view, shared, store } = await mount();
    await press(view.byTestId('il-fpl-preview'));
    await press(view.byTestId('il-fpl-share'));
    const { fplText, hebrewSummary } = store.getState();
    expect(shared).toEqual([`${fplText}\n\n${hebrewSummary}`]);
  });

  test('the preview rebuilds the message from the current profiles', async () => {
    let pilot = newPilotProfile({ name: 'First Pilot', isActive: true });
    const { view, store } = await mount({ profiles: () => ({ aircraft: [FIXTURE_AIRCRAFT], pilots: [pilot] }) });
    expect(store.getState().fplText).toContain('PIC FIRST PILOT');
    pilot = newPilotProfile({ name: 'Second Pilot', isActive: true });
    await press(view.byTestId('il-fpl-preview'));
    expect(view.byTestId('il-fpl-text').props.children).toContain('PIC SECOND PILOT');
  });

  test('FPL message and Activate are disabled when the plan cannot be filed', async () => {
    const { view } = await mount({ profiles: () => ({ aircraft: [], pilots: [] }) });
    expect(view.text()).toContain('LLHZ \u2192 BAZRA');
    expect(view.byTestId('il-fpl-preview').props.accessibilityState).toEqual({ disabled: true });
    expect(view.byTestId('il-activate').props.accessibilityState).toEqual({ disabled: true });
  });

  test('Activate hands the route to navigation, then reads Active; Clear empties the sheet and navigation', async () => {
    const activated: string[] = [];
    let active = false;
    const { view, store } = await mount({
      navigation: {
        activate: (a) => {
          active = true;
          activated.push(`${a.planDeparture}-${a.planDestination}-${a.activeRoute.legs.length}`);
        },
        hasActiveRoute: () => active,
        clear: () => {
          active = false;
        },
      },
    });
    await press(view.byTestId('il-activate'));
    expect(activated).toEqual(['LLHZ-LLIB-12']);
    expect(view.text()).toContain('Active');
    expect(view.byTestId('il-activate').props.accessibilityState).toEqual({ disabled: true });
    await press(view.byLabel('Clear')[0]);
    expect(active).toBe(false);
    expect(store.getState().departure).toBeNull();
    expect(view.all((n) => n.props?.testID === 'il-legs')).toHaveLength(0);
  });

  test('Route weather opens Windy for the route', async () => {
    const { view, opened } = await mount();
    await press(view.byLabel('Route weather')[0]);
    expect(opened).toEqual(['https://www.windy.com/distance/32.1794/34.8344/32.9806/35.5708']);
  });

  test('typing in the departure picker lists plannable aerodromes; a tap selects one', async () => {
    const { view, store } = await mount({}, false);
    await callHandler(view.byLabel('Departure aerodrome')[0], 'onChangeText', 'rosh');
    await settle();
    const result = view.byLabel('LLIB Rosh Pina Airport');
    expect(result).toHaveLength(1);
    await press(result[0]);
    expect(store.getState().departure?.code).toBe('LLIB');
    expect(store.getState().departureQuery).toBe('LLIB');
    expect(view.byLabel('LLIB Rosh Pina Airport')).toHaveLength(0);
  });

  test('a via point outside the network is refused with the reason; a known one is listed and reroutes', async () => {
    const { view, store } = await mount();
    await callHandler(view.byLabel('Via point')[0], 'onChangeText', 'nope');
    await press(view.byLabel('Add')[0]);
    await settle();
    expect(view.text()).toContain('NOPE is not a reporting point of the CVFR network.');
    await callHandler(view.byLabel('Via point')[0], 'onChangeText', 'tavor');
    await callHandler(view.byLabel('Via point')[0], 'onSubmitEditing');
    await settle();
    expect(store.getState().viaCodes).toEqual(['TAVOR']);
    expect(view.byLabel('Remove via TAVOR')).toHaveLength(1);
    await press(view.byLabel('Remove via TAVOR')[0]);
    expect(store.getState().viaCodes).toEqual([]);
  });

  test('LSA shows the day picker and the weekend rule; the fixture network has no LSA route', async () => {
    const { view, store } = await mount();
    expect(view.all((n) => n.props?.testID === 'il-day-override')).toHaveLength(0);
    await press(view.byLabel('LSA (sport aviation)')[0]);
    await settle();
    expect(store.getState().network).toBe('lsa');
    expect(view.byTestId('il-day-override')).toBeTruthy();
    await press(view.byLabel('Weekend-only routes (AIP B-08)')[0]);
    expect(view.text()).toContain('Source: Domestic AIP B-08');
    // The fixture has CVFR data only: LLHZ is not a point of the LSA network.
    expect(view.byTestId('il-no-route')).toBeTruthy();
    expect(view.text()).toContain('LLHZ is not on the route network.');
  });

  test('the departure stepper moves the time by 15 minutes and reroutes', async () => {
    const { view, store } = await mount();
    const before = store.getState().departureTime;
    await press(view.byLabel('Departure 15 minutes later')[0]);
    expect(store.getState().departureTime).toBe(before + 15 * 60_000);
    expect(before).toBe(Date.UTC(2026, 10, 12, 7));
    await settle();
    expect(store.getState().plan).not.toBeNull();
    // Never before now (FIXTURE_NOW, 06:26Z): five steps back from 07:15Z stop at the clock.
    for (let i = 0; i < 5; i++) await press(view.byLabel('Departure 15 minutes earlier')[0]);
    expect(store.getState().departureTime).toBe(FIXTURE_NOW);
  });

  test('route options expand to the two override switches', async () => {
    const { view, store } = await mount();
    await press(view.byLabel('Route options')[0]);
    await callHandler(view.byLabel('Allow military routes (IAF approval, not fileable)')[0], 'onValueChange', true);
    expect(store.getState().allowMilitary).toBe(true);
  });

  test('NOTAM briefing opens the briefing for the planned route', async () => {
    const routes: (string[] | null)[] = [];
    const { view } = await mount({ openBriefing: (route) => routes.push(route?.codes ?? null) });
    await press(view.byTestId('il-notam-briefing'));
    expect(routes[0]?.[0]).toBe('LLHZ');
    expect(routes[0]?.[routes[0].length - 1]).toBe('LLIB');
  });

  test('the israel-plan route shows the fixture plan once it has routed', async () => {
    const view = await render(<IsraelPlanRoute />);
    await settle();
    expect(view.byTestId('il-summary')).toBeTruthy();
    expect(view.text()).toContain('LEGS 12');
  });
});
