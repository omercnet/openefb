import { useEffect, useState } from 'react';
import { SafeAreaView, Text, View } from 'react-native';
import { LargeTitle, NavBar } from '../form/Form';
import { Pressy, ThemeContext } from '../Primitives';
import { FlightPlanSheet } from '../sheets/flightPlan/FlightPlanSheet';
import { FlightPlanProvider, type FlightPlanState } from '../sheets/flightPlan/store';
import { createLiveFlightPlanStore, type UsPlannerDeps } from './usPlanner';
import { IsraelFlightPlanSheet } from '../sheets/israelPlan/IsraelFlightPlanSheet';
import { IsraelPlanProvider, type IsraelPlanState } from '../sheets/israelPlan/store';
import { useLiveTheme } from '../state/night';
import { Space, Type } from '../tokens';
import type { StoreApi } from 'zustand';
import { createLiveIsraelPlanStore, type createPlannerNetworkStore, type LivePlannerDeps } from './israelPlanner';

/**
 * The flight planner pushed from the Log (LogRoute.planner): FlightPlanView shows IsraelFlightPlanView in the Israel
 * region. The US planner is a separate screen (U4c).
 */
export function LiveIsraelPlanner({ store, onClose }: { store: StoreApi<IsraelPlanState>; onClose: () => void }) {
  const theme = useLiveTheme();
  return (
    <ThemeContext.Provider value={theme}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.paper }} testID="live-israel-planner">
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: Space.m, gap: Space.m }}>
          <Pressy accessibilityRole="button" accessibilityLabel="Back" onPress={onClose} testID="planner-back">
            <Text style={[Type.title, { color: theme.accent }]}>Back</Text>
          </Pressy>
          <Text style={[Type.title, { color: theme.ink }]}>Plan a flight</Text>
        </View>
        <IsraelPlanProvider store={store}>
          <IsraelFlightPlanSheet />
        </IsraelPlanProvider>
      </SafeAreaView>
    </ThemeContext.Provider>
  );
}

/** The US planner pushed from the Log: FlightPlanView in the US region (U4c's FlightPlanSheet over a plan store). */
export function LiveUsPlanner({ store, onClose }: { store: StoreApi<FlightPlanState>; onClose: () => void }) {
  const theme = useLiveTheme();
  return (
    <ThemeContext.Provider value={theme}>
      <View style={{ flex: 1, backgroundColor: theme.paper }} testID="live-us-planner">
        <UsPlannerHeader onBack={onClose} />
        <FlightPlanProvider store={store}>
          <FlightPlanSheet region="us" />
        </FlightPlanProvider>
      </View>
    </ThemeContext.Provider>
  );
}

/** FlightPlanView.navigationTitle("Flight Plans") on the Log stack: the Back button, then the large title (as Settings). */
export function UsPlannerHeader({ onBack }: { onBack: () => void }) {
  return (
    <>
      <NavBar title="Flight Plans" onBack={onBack} backTestID="planner-back" largeTitle />
      <LargeTitle title="Flight Plans" />
    </>
  );
}

/** One fresh plan store for as long as the screen is open (Swift: a FlightPlanViewModel per presentation). */
export function UsPlannerHost({ deps, onClose }: { deps: UsPlannerDeps; onClose: () => void }) {
  const [store] = useState(() => createLiveFlightPlanStore(deps));
  return <LiveUsPlanner store={store} onClose={onClose} />;
}

/**
 * Opens the planner: the stored route-network choices of the aircraft are read first (the planner reads them
 * synchronously), then one fresh plan store lives as long as the screen does.
 */
export function PlannerHost({
  deps,
  networkStore,
  onClose,
}: {
  deps: Omit<LivePlannerDeps, 'networkPreferences'>;
  networkStore: ReturnType<typeof createPlannerNetworkStore>;
  onClose: () => void;
}) {
  const [store, setStore] = useState<StoreApi<IsraelPlanState> | null>(null);
  useEffect(() => {
    let cancelled = false;
    networkStore.warm(deps.profiles().aircraft.map((a) => a.id)).then(() => {
      if (!cancelled) setStore(createLiveIsraelPlanStore({ ...deps, networkPreferences: networkStore }));
    });
    return () => {
      cancelled = true;
    };
    // The deps are fixed for the life of the runtime; a new plan store is made each time the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return store ? <LiveIsraelPlanner store={store} onClose={onClose} /> : null;
}
