import { useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IsraelFlightPlanSheet } from '../ui/sheets/israelPlan/IsraelFlightPlanSheet';
import { createFixturePlanStore, seedFixturePlan } from '../ui/sheets/israelPlan/fixture';
import { IsraelPlanProvider } from '../ui/sheets/israelPlan/store';

/**
 * Route israel-plan: the Israel flight plan sheet over FAKE data (fixture.ts), LLHZ to LLIB routed on CVFR. Not in the
 * fidelity gate yet: the ipad-israel-plan reference comes later (app/docs/port-notes/U4b-plan.md).
 */
export default function IsraelPlanRoute() {
  const [store] = useState(() => createFixturePlanStore());
  useEffect(() => {
    void seedFixturePlan(store);
  }, [store]);
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <IsraelPlanProvider store={store}>
        <IsraelFlightPlanSheet />
      </IsraelPlanProvider>
    </SafeAreaView>
  );
}
