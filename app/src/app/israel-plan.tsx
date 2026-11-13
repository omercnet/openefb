import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../ui/Primitives';
import { IsraelFlightPlanSheet, formColors } from '../ui/sheets/israelPlan/IsraelFlightPlanSheet';
import { ISRAEL_PLAN_CAPTURE_NOW, createFixturePlanStore } from '../ui/sheets/israelPlan/fixture';
import { IsraelPlanProvider } from '../ui/sheets/israelPlan/store';

/**
 * Route israel-plan (fidelity gate screen): the Israel flight plan sheet on FAKE data (fixture.ts) in its empty state, as
 * the SwiftUI capture shows it (`-OpenEFBRoute israel-plan`, no stored data: empty departure and destination, no plan).
 * The routed LLHZ to LLIB plan of the fixture is seeded by the tests, not by the route.
 */
export default function IsraelPlanRoute() {
  const t = useTheme();
  const [store] = useState(() => createFixturePlanStore({ now: () => ISRAEL_PLAN_CAPTURE_NOW }));
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: formColors(t).background }}>
      <IsraelPlanProvider store={store}>
        <IsraelFlightPlanSheet />
      </IsraelPlanProvider>
    </SafeAreaView>
  );
}
