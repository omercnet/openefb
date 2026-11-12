// The briefing sheet over the map, as the capture route (kanaf-dev://briefing, iOS -KanafScreen briefing) and the web
// preview mount it: the SwiftUI shot opens the sheet over the map with the strip on the Log (-OpenEFBScreen map
// -OpenEFBStripColumn log -OpenEFBBriefing YES). Like the sheet probe (screens/SheetScreen.tsx), @expo/ui's BottomSheet
// presents a real SwiftUI sheet on iOS (page-sized on iPad, the .presentationSizing(.page) of IsraelBriefingView) and a
// Material 3 sheet on Android; the React Native content sits in an RNHostView. Fakes only: the fixture's feed and an
// in-memory read store.
import { BottomSheet, RNHostView } from '@expo/ui';
import type { ModifierConfig } from '@expo/ui/swift-ui/modifiers';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { MapScreen } from '../../screens/MapScreen';
import { FIXTURE_NOW, MemoryNotamReadStore, captureBriefingData, fixtureReport } from './fixture';
import { IsraelBriefingSheet } from './IsraelBriefingSheet';
import { IsraelBriefingViewModel, briefing, noBriefingActions } from './store';

// Same object presentationSizing('page') builds; written out because importing '@expo/ui/swift-ui/modifiers' at runtime
// calls requireNativeModule('ExpoUI'), which the web preview does not have.
const PAGE_SHEET: ModifierConfig = { $type: 'presentationSizing', sizing: 'page' };

const captureModel = () =>
  new IsraelBriefingViewModel(briefing.make(captureBriefingData()), {
    fetcher: async () => fixtureReport(),
    readStore: new MemoryNotamReadStore(),
    now: () => FIXTURE_NOW,
  });

export function BriefingOverMap() {
  const [model] = useState(captureModel);
  const [presented, setPresented] = useState(true);
  const actions = { ...noBriefingActions, dismiss: () => setPresented(false) };
  return (
    <View style={{ flex: 1 }}>
      <MapScreen screen="map" />
      <BottomSheet
        isPresented={presented}
        onDismiss={() => setPresented(false)}
        snapPoints={['full']}
        containerColor="#F2F2F7" // systemGroupedBackground, the inset-grouped List behind the cards
        // iPad (regular width) ignores detents and shows a small form sheet; ask for the large page sheet instead.
        modifiers={Platform.OS === 'ios' ? [PAGE_SHEET] : undefined}
      >
        <RNHostView>
          <View style={{ flex: 1 }}>
            <IsraelBriefingSheet model={model} actions={actions} />
          </View>
        </RNHostView>
      </BottomSheet>
    </View>
  );
}
