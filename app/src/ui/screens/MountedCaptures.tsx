// The screens I1d put on the live app that have no SwiftUI capture to compare with (the U4c screens, the alert banner): the
// US flight plan, the CVFR chart sheet, the PIREP and winds aloft sections and the Israel alerts on the strip. The real
// screens over fakes, routes kanaf-dev://usplan, chartsheet, chartairspace, aloft and alerts. Captured for the PR and the
// device checks, never gated (there is no reference to score them against).
import { useFonts } from 'expo-font';
import { useState, type ReactNode } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MapCaptureScreen } from '../capture/MapCaptureScreen';
import { PirepSection } from '../columns/airport/sections/PirepSection';
import { WindsAloftSection } from '../columns/airport/sections/WindsAloftSection';
import { KDEN, PIREP_NOW, PIREPS, SFO_REPORT } from '../columns/airport/sections/fixture';
import { dayFixture } from '../flightLog/fixtures';
import { flightLog } from '../flightLog/store';
import { FlightPlanSheet } from '../sheets/flightPlan/FlightPlanSheet';
import {
  FIXTURE_NOW,
  createFixtureFlightPlanStore,
  FIXTURE_SAVED_PLANS,
  KPAO,
  KSQL,
} from '../sheets/flightPlan/fixture';
import { FlightPlanProvider } from '../sheets/flightPlan/store';
import { IsraelChartSheet } from '../sheets/israelChart/IsraelChartSheet';
import { AIRSPACES_SELECTION, POINT_SELECTION } from '../sheets/israelChart/fixture';
import { FontFiles } from '../tokens';
import { ScreenFrame } from './CaptureScreens';

function Framed({ children }: { children: ReactNode }) {
  const [loaded, error] = useFonts(FontFiles);
  // Below the status bar and above the home indicator, as the screens sit in the shell (they are not full-bleed).
  return (
    <ScreenFrame>
      {loaded || error != null ? <SafeAreaView style={{ flex: 1 }}>{children}</SafeAreaView> : null}
    </ScreenFrame>
  );
}

/** kanaf-dev://usplan: Flight Plans in the US, a KPAO to KSQL plan picked and the saved plans below. */
export function UsPlanCapture() {
  const [store] = useState(() => {
    const made = createFixtureFlightPlanStore({ plans: FIXTURE_SAVED_PLANS });
    void made.store.getState().configure();
    made.store.getState().selectDeparture(KPAO);
    made.store.getState().selectDestination(KSQL);
    made.store.getState().calculateAndDrawRoute();
    return made.store;
  });
  return (
    <Framed>
      <FlightPlanProvider store={store}>
        <FlightPlanSheet region="us" />
      </FlightPlanProvider>
    </Framed>
  );
}

/** kanaf-dev://chartsheet and chartairspace: the CVFR chart sheet for a tapped reporting point and for airspaces. */
export function ChartSheetCapture({ airspaces = false }: { airspaces?: boolean }) {
  return (
    <Framed>
      <IsraelChartSheet selection={airspaces ? AIRSPACES_SELECTION : POINT_SELECTION} onClose={() => undefined} />
    </Framed>
  );
}

/** kanaf-dev://aloft: the PIREP and winds aloft sections as the airport column stacks them. */
export function AloftCapture() {
  return (
    <Framed>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 24 }}>
        <PirepSection
          airport={KDEN}
          loading={false}
          error={null}
          pireps={PIREPS}
          now={PIREP_NOW}
          onRetry={() => undefined}
        />
        <WindsAloftSection
          airport={KDEN}
          forecast={6}
          onSelectForecast={() => undefined}
          loading={false}
          error={null}
          report={SFO_REPORT}
          now={FIXTURE_NOW}
          onRetry={() => undefined}
        />
      </ScrollView>
    </Framed>
  );
}

const ALERTS = [
  {
    id: 'prohibited-1',
    severity: 'warning',
    kind: 'prohibited',
    title: 'Inside prohibited area LLP-1',
    detail: 'Leave the area now.',
  },
  { id: 'border-1', severity: 'caution', kind: 'border', title: 'Near the Lebanon border buffer', detail: '2.1 NM' },
  { id: 'closure-1', severity: 'caution', kind: 'closure', title: 'Route closure ahead', detail: 'DEROR to SHARO' },
] as const;

/** kanaf-dev://alerts: the strip in Israel with the alert banner and the airspace check notice. */
export function AlertsCapture() {
  const [store] = useState(() =>
    flightLog.make({
      ...dayFixture,
      region: 'israel',
      israelAlerts: ALERTS as never,
      airspaceCheckUnavailable: true,
    }),
  );
  return (
    <flightLog.Provider store={store}>
      <MapCaptureScreen screen="map" />
    </flightLog.Provider>
  );
}
