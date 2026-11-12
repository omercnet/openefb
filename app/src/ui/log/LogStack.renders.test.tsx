// Each section subscribes to its own fields: a recording-time, clock or GPS update re-renders the Now row only, a logbook
// change the Flown and Totals rows only. Every section is counted: each one renders exactly one presentational component
// (LogRows, or the map glyph for the navigation bar), wrapped here in a counter. Counting components rather than the text
// builders also catches re-renders a useMemo would hide.
import { act } from 'react';
import { render } from '../../../tests/support/ui';
import { flightLog, type FlightLogData } from '../flightLog/store';
import { ThemeContext } from '../Primitives';
import { Day } from '../tokens';
import { entry, flight, REFERENCE_FLIGHT_LOG, REFERENCE_LOG, REFERENCE_NOW_MS } from './fixtures';
import * as icons from './LogIcons';
import * as rows from './LogRows';
import { LogStack } from './LogStack';
import { log, logActions } from './store';

jest.mock('./LogRows', () => {
  const actual = jest.requireActual('./LogRows');
  const counted = (name: string) => jest.fn((props: object) => actual[name](props));
  return {
    ...actual,
    LogSectionHeader: counted('LogSectionHeader'),
    ActivePlanRow: counted('ActivePlanRow'),
    PlanFlightRow: counted('PlanFlightRow'),
    NowRow: counted('NowRow'),
    AddEntryButton: counted('AddEntryButton'),
    FlownFlightRow: counted('FlownFlightRow'),
    TotalsRow: counted('TotalsRow'),
  };
});
jest.mock('./LogIcons', () => {
  const actual = jest.requireActual('./LogIcons');
  return { ...actual, MapGlyph: jest.fn((props: object) => actual.MapGlyph(props)) };
});

/** Section -> the component only it renders (the headers count the container). */
const SECTIONS = {
  navigationBar: icons.MapGlyph,
  container: rows.LogSectionHeader,
  activePlan: rows.ActivePlanRow,
  planFlight: rows.PlanFlightRow,
  now: rows.NowRow,
  addEntry: rows.AddEntryButton,
  flown: rows.FlownFlightRow,
  totals: rows.TotalsRow,
} as const;
type Section = keyof typeof SECTIONS;

/** Sections that rendered since the mount (a section with several rows counts once). */
const rendered = (): Section[] =>
  (Object.keys(SECTIONS) as Section[]).filter((s) => jest.mocked(SECTIONS[s]).mock.calls.length > 0);

/** Navigating a plan to LLIB while recording, with one flight and its entry: every section is mounted. */
const MOUNTED: FlightLogData = {
  ...REFERENCE_FLIGHT_LOG,
  activeFlightPlan: true,
  planDeparture: 'LLHZ',
  planDestination: 'LLIB',
  estimatedTimeEnroute: 600,
  ownshipFix: { timestampMs: REFERENCE_NOW_MS, horizontalAccuracyM: 5, verticalAccuracyM: 5, isStationary: false },
};

async function mount() {
  const f = flight({ id: 'f1', startDate: 1 });
  const logStore = log.make({ ...REFERENCE_LOG, flights: [f], entries: [entry({ flightID: 'f1', date: 1 })] });
  const flightStore = flightLog.make(MOUNTED);
  const actionsStore = logActions.make();
  const view = await render(
    <ThemeContext.Provider value={Day}>
      <flightLog.Provider store={flightStore}>
        <log.Provider store={logStore}>
          <logActions.Provider store={actionsStore}>
            <LogStack />
          </logActions.Provider>
        </log.Provider>
      </flightLog.Provider>
    </ThemeContext.Provider>,
  );
  expect(rendered()).toEqual(Object.keys(SECTIONS));
  jest.clearAllMocks();
  return { view, logStore, flightStore, actionsStore };
}

describe('LogStack re-renders only the section whose data changed', () => {
  beforeEach(() => {
    jest.useFakeTimers({
      now: REFERENCE_NOW_MS,
      doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout'],
    });
  });
  afterEach(() => jest.useRealTimers());

  it('a recording-time update re-renders the Now row only', async () => {
    const { view, flightStore } = await mount();
    const recording = MOUNTED.recording!;
    await act(async () => flightStore.setState({ recording: { ...recording, elapsedSeconds: 6 } }));
    expect(view.text()).toContain('REC 0:00:06');
    expect(rendered()).toEqual(['now']);
  });

  it('a clock tick re-renders the Now row only', async () => {
    await mount();
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(rendered()).toEqual(['now']);
  });

  it('a GPS availability change re-renders the Now row only', async () => {
    const { flightStore } = await mount();
    await act(async () => flightStore.setState({ gpsAvailable: false }));
    expect(rendered()).toEqual(['now']);
  });

  it('a new fix re-renders the Now row only', async () => {
    const { flightStore } = await mount();
    await act(async () =>
      flightStore.setState({ ownshipFix: { ...MOUNTED.ownshipFix!, timestampMs: REFERENCE_NOW_MS + 1 } }),
    );
    expect(rendered()).toEqual(['now']);
  });

  it('an ETE update re-renders the Now row only', async () => {
    const { flightStore } = await mount();
    await act(async () => flightStore.setState({ estimatedTimeEnroute: 590 }));
    expect(rendered()).toEqual(['now']);
  });

  it('a new destination re-renders the active plan and Now rows only', async () => {
    const { view, flightStore } = await mount();
    await act(async () => flightStore.setState({ planDestination: 'LLBG' }));
    expect(view.text()).toContain('LLHZ \u25B8 LLBG');
    expect(rendered()).toEqual(['activePlan', 'now']);
  });

  it('a flight log field the Log does not show re-renders nothing', async () => {
    const { flightStore } = await mount();
    await act(async () => flightStore.setState({ groundSpeed: 120 }));
    await act(async () => flightStore.setState({ altitude: 900 }));
    await act(async () => flightStore.setState({ isOffline: true }));
    expect(rendered()).toEqual([]);
  });

  it('a logbook entry change re-renders the Flown and Totals rows only', async () => {
    const { view, logStore } = await mount();
    await act(async () => logStore.setState({ entries: [] }));
    expect(view.text()).toContain('0 flights');
    expect(rendered()).toEqual(['flown', 'totals']);
  });

  it('a recorded flight change re-renders the Flown rows only', async () => {
    const { logStore } = await mount();
    await act(async () => logStore.setState({ flights: [flight({ id: 'f2', startDate: 2 })] }));
    expect(rendered()).toEqual(['flown']);
  });

  it('a new action re-renders only the section that uses it', async () => {
    const { actionsStore } = await mount();
    await act(async () => actionsStore.setState({ openFlight: () => {} }));
    expect(rendered()).toEqual(['flown']);
    jest.clearAllMocks();
    await act(async () => actionsStore.setState({ openSettings: () => {} }));
    expect(rendered()).toEqual(['navigationBar']);
    jest.clearAllMocks();
    await act(async () => actionsStore.setState({ addEntry: () => {} }));
    expect(rendered()).toEqual(['addEntry']);
  });
});
