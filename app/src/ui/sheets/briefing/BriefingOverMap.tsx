// The briefing sheet over the map, as the capture route (kanaf-dev://briefing, iOS -KanafScreen briefing) and the web
// preview mount it: the SwiftUI shot opens the sheet over the map with the strip on the Log (-OpenEFBScreen map
// -OpenEFBStripColumn log -OpenEFBBriefing YES). BriefingPresentation presents it: a real SwiftUI page sheet on iOS
// (@expo/ui's BottomSheet, like the sheet probe in screens/SheetScreen.tsx), a React Native form sheet inset from the
// edges on Android. Fakes only: the fixture's feed and an in-memory read store.
import { useState } from 'react';
import { View } from 'react-native';
import { MapScreen } from '../../screens/MapScreen';
import { BriefingPresentation } from './BriefingPresentation';
import { FIXTURE_NOW, MemoryNotamReadStore, captureBriefingData, fixtureReport } from './fixture';
import { IsraelBriefingSheet } from './IsraelBriefingSheet';
import { IsraelBriefingViewModel, briefing, noBriefingActions } from './store';

const captureModel = () =>
  new IsraelBriefingViewModel(briefing.make(captureBriefingData()), {
    fetcher: async () => fixtureReport(),
    readStore: new MemoryNotamReadStore(),
    now: () => FIXTURE_NOW,
  });

export function BriefingOverMap() {
  const [model] = useState(captureModel);
  const [presented, setPresented] = useState(true);
  const dismiss = () => setPresented(false);
  const actions = { ...noBriefingActions, dismiss };
  return (
    <View style={{ flex: 1 }}>
      <MapScreen screen="map" />
      <BriefingPresentation presented={presented} onDismiss={dismiss}>
        <IsraelBriefingSheet model={model} actions={actions} />
      </BriefingPresentation>
    </View>
  );
}
