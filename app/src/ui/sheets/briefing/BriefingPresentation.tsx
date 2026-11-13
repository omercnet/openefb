// How the briefing sheet is presented over the map. iOS and the web preview keep @expo/ui's BottomSheet: a real SwiftUI
// sheet on iOS (the page sheet of IsraelBriefingView's .presentationSizing(.page)). On Android that component is a
// Material 3 ModalBottomSheet, which caps its width (a narrow centred card on a tablet) and adds a grab handle, and
// @expo/ui exposes no width for it. So Android draws the iPad form sheet itself: a React Native overlay over the map,
// dimmed backdrop, the sheet inset SHEET_INSET from the left, right, top and bottom safe edges, all corners rounded.
import { BottomSheet, RNHostView } from '@expo/ui';
import type { ModifierConfig } from '@expo/ui/swift-ui/modifiers';
import { useEffect, type ReactNode } from 'react';
import { BackHandler, Platform, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Same object presentationSizing('page') builds; written out because importing '@expo/ui/swift-ui/modifiers' at runtime
// calls requireNativeModule('ExpoUI'), which the web preview does not have.
const PAGE_SHEET: ModifierConfig = { $type: 'presentationSizing', sizing: 'page' };

/** systemGroupedBackground, the inset-grouped List behind the cards. */
const CONTAINER_COLOR = '#F2F2F7';
/** The form sheet's inset from the screen edges (the iPad reference: about 16 pt left and right). */
export const SHEET_INSET = 16;
/** Corner radius of the Android sheet (Material's extra-large shape, close to the iPad sheet's corners). */
export const SHEET_RADIUS = 28;
/** The dimming behind the sheet. */
export const BACKDROP_COLOR = 'rgba(0,0,0,0.3)';

/** The Android sheet's container: inset from every edge, below the status bar and above the navigation bar. */
export const androidSheetStyle = (insets: { top: number; bottom: number; left: number; right: number }): ViewStyle => ({
  position: 'absolute',
  top: insets.top + SHEET_INSET,
  bottom: insets.bottom + SHEET_INSET,
  left: insets.left + SHEET_INSET,
  right: insets.right + SHEET_INSET,
  borderRadius: SHEET_RADIUS,
  overflow: 'hidden',
  backgroundColor: CONTAINER_COLOR,
});

function AndroidFormSheet({ onDismiss, children }: { onDismiss: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  useEffect(() => {
    // The system back gesture dismisses, as it does the native sheet.
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onDismiss();
      return true;
    });
    return () => subscription.remove();
  }, [onDismiss]);
  return (
    <View testID="briefing-sheet-overlay" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}>
      {/* Like the iPad page sheet, a tap on the dimmed map does not dismiss (Done and back do), nor reach the map. */}
      <View
        testID="briefing-sheet-backdrop"
        onStartShouldSetResponder={() => true}
        style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: BACKDROP_COLOR }}
      />
      <View testID="briefing-sheet-container" accessibilityViewIsModal style={androidSheetStyle(insets)}>
        {children}
      </View>
    </View>
  );
}

/** Presents `children` (the sheet content, which fills its container) over whatever is behind it. */
export function BriefingPresentation({
  presented,
  onDismiss,
  children,
}: {
  presented: boolean;
  onDismiss: () => void;
  children: ReactNode;
}) {
  if (Platform.OS === 'android') {
    return presented ? <AndroidFormSheet onDismiss={onDismiss}>{children}</AndroidFormSheet> : null;
  }
  return (
    <BottomSheet
      isPresented={presented}
      onDismiss={onDismiss}
      snapPoints={['full']}
      containerColor={CONTAINER_COLOR}
      // iPad (regular width) ignores detents and shows a small form sheet; ask for the large page sheet instead.
      modifiers={Platform.OS === 'ios' ? [PAGE_SHEET] : undefined}
    >
      <RNHostView>
        <View style={{ flex: 1 }}>{children}</View>
      </RNHostView>
    </BottomSheet>
  );
}
