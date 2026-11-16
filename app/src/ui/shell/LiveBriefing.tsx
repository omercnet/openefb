import { useMemo } from 'react';
import { Linking, View } from 'react-native';
import { useFonts } from 'expo-font';
import type { Coordinate } from '../../domain/core';
import type { BriefingRoute } from '../../domain/israel/briefingFilter';
import type { IsraelNotam } from '../../domain/israel/notamTypes';
import { highlightFor, type Highlight } from '../sheets/briefing/briefingHighlight';
import { BriefingPresentation } from '../sheets/briefing/BriefingPresentation';
import { IsraelBriefingSheet } from '../sheets/briefing/IsraelBriefingSheet';
import type { HighlightTint } from '../sheets/briefing/logic';
import {
  IsraelBriefingViewModel,
  briefing,
  emptyBriefingData,
  type BriefingActions,
  type BriefingFetcher,
  type BriefingReadStore,
} from '../sheets/briefing/store';
import { FontFiles } from '../tokens';

export interface LiveBriefingProps {
  fetcher: BriefingFetcher;
  readStore: BriefingReadStore;
  ownship: Coordinate | null;
  /** The planned route the briefing filters to (the planner's Brief button); null: no route. */
  route?: BriefingRoute | null;
  pointLookup: (code: string) => Coordinate | null;
  presented: boolean;
  /** The map still shows a highlight from an earlier "Show on map": the sheet offers to clear it. */
  highlightActive?: boolean;
  onDismiss: () => void;
  /** IsraelBriefingMapHighlight: draw and frame the NOTAM; false when there is nothing to draw. */
  onShow: (highlight: Highlight) => void;
  onClear: () => void;
  now?: () => number;
}

/**
 * IsraelBriefingView over the live map (ContentView / MapContainerView present it from AppState.isPresentingIsraelBriefing):
 * the relay feed through IsraelNotamService, the read state in NotamReadStateStore, and "Show on map" on the live map.
 */
export function LiveBriefing({
  fetcher,
  readStore,
  ownship,
  route = null,
  pointLookup,
  presented,
  highlightActive,
  onDismiss,
  onShow,
  onClear,
  now,
}: LiveBriefingProps) {
  // One model per presentation: filters and the loaded feed start fresh each time the sheet opens, as the Swift view's
  // @State does. The ownship is the position at that moment (IsraelBriefingViewModel.ownship).
  const model = useMemo(
    () =>
      presented
        ? new IsraelBriefingViewModel(
            briefing.make(emptyBriefingData(route, ownship ? { lat: ownship.lat, lon: ownship.lon } : null)),
            { fetcher, readStore, ...(now ? { now } : {}) },
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new model per presentation; the position is read when it opens
    [presented, fetcher, readStore, now, route],
  );
  const [fontsLoaded, fontError] = useFonts(FontFiles);
  const actions: BriefingActions = useMemo(
    () => ({
      dismiss: onDismiss,
      showOnMap: (notam: IsraelNotam, tint: HighlightTint) => {
        const highlight = highlightFor(notam, tint, pointLookup);
        if (!highlight) return false;
        onShow(highlight);
        return true;
      },
      clearHighlight: onClear,
      openURL: (url: string) => void Linking.openURL(url),
    }),
    [onDismiss, onShow, onClear, pointLookup],
  );
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}>
      <BriefingPresentation presented={presented} onDismiss={onDismiss}>
        {model && (fontsLoaded || fontError != null) ? (
          <IsraelBriefingSheet model={model} actions={actions} highlightActive={highlightActive ?? false} />
        ) : null}
      </BriefingPresentation>
    </View>
  );
}
