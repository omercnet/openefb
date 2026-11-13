// The briefing sheet over the map, as the capture route (kanaf-dev://briefing, iOS -KanafScreen briefing) and the web
// preview mount it: the SwiftUI shot opens the sheet over the map with the strip on the Log (-OpenEFBScreen map
// -OpenEFBStripColumn log -OpenEFBBriefing YES). BriefingPresentation presents it: a real SwiftUI page sheet on iOS
// (@expo/ui's BottomSheet, like the sheet probe in screens/SheetScreen.tsx), a React Native form sheet inset from the
// edges on Android. Fakes only: the fixture's feed and an in-memory read store.
import { useFonts } from 'expo-font';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { MapScreen } from '../../screens/MapScreen';
import { FontFiles } from '../../tokens';
import { BriefingPresentation } from './BriefingPresentation';
import { FIXTURE_NOW, MemoryNotamReadStore, captureBriefingData, fixtureReport } from './fixture';
import { IsraelBriefingSheet } from './IsraelBriefingSheet';
import { IsraelBriefingViewModel, briefing, noBriefingActions } from './store';

const HIDDEN_FROM_ASSISTIVE_TECH = {
  importantForAccessibility: 'no-hide-descendants',
  accessibilityElementsHidden: true,
} as const;

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
  // Text sized to its content (the Feed label) is measured once: with the bundled faces not registered yet Android measures a
  // fallback face and then draws the wider Archivo into that box, clipping the last glyph ("Fee"). Like the strip, show the
  // sheet content only once the faces are loaded (or failed to load).
  const [fontsLoaded, fontError] = useFonts(FontFiles);
  const ready = fontsLoaded || fontError != null;
  const actions = { ...noBriefingActions, dismiss };
  return (
    <View style={{ flex: 1 }}>
      {/* While the Android overlay is up, TalkBack must not reach the map and strip behind it (accessibilityViewIsModal is
          iOS only): hide that subtree, and restore it when the sheet is dismissed. */}
      <View
        testID="briefing-background"
        style={{ flex: 1 }}
        {...(Platform.OS === 'android' && presented ? HIDDEN_FROM_ASSISTIVE_TECH : null)}
      >
        <MapScreen screen="map" />
      </View>
      <BriefingPresentation presented={presented} onDismiss={dismiss}>
        {ready ? <IsraelBriefingSheet model={model} actions={actions} /> : null}
      </BriefingPresentation>
    </View>
  );
}
