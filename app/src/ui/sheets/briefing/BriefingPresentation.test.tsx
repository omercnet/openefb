// The briefing sheet's presentation: Android draws an inset form sheet over a dimmed backdrop; iOS (and the web preview)
// keep @expo/ui's BottomSheet with the page sizing. The native BottomSheet is replaced by a host stand-in that records
// its props.
import { BackHandler, Platform, StyleSheet, Text } from 'react-native';
import { render } from '../../../../tests/support/ui';
import { BACKDROP_COLOR, BriefingPresentation, SHEET_INSET, SHEET_RADIUS } from './BriefingPresentation';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('@expo/ui', () => {
  const { createElement } = jest.requireActual('react');
  return {
    BottomSheet: ({ children, ...props }: { children: unknown }) =>
      createElement('ExpoUIBottomSheet', { testID: 'native-bottom-sheet', ...props }, children),
    RNHostView: ({ children }: { children: unknown }) => createElement('ExpoUIRNHostView', null, children),
  };
});

const present = (presented = true, onDismiss = jest.fn()) =>
  render(
    <BriefingPresentation presented={presented} onDismiss={onDismiss}>
      <Text>sheet content</Text>
    </BriefingPresentation>,
  );

describe('BriefingPresentation', () => {
  describe('on Android', () => {
    beforeEach(() => jest.replaceProperty(Platform, 'OS', 'android'));

    it('insets the sheet 16 dp from both edges and the top, rounded, over a dimmed backdrop', async () => {
      const view = await present();
      expect(view.all((n) => n.props.testID === 'native-bottom-sheet')).toHaveLength(0);
      const container = StyleSheet.flatten(view.byTestId('briefing-sheet-container').props.style);
      // The jest safe-area mock reports zero insets, so the edges are the inset itself.
      expect(container).toMatchObject({
        position: 'absolute',
        left: SHEET_INSET,
        right: SHEET_INSET,
        top: SHEET_INSET,
        bottom: SHEET_INSET,
        borderRadius: SHEET_RADIUS,
        overflow: 'hidden',
      });
      expect(SHEET_INSET).toBe(16);
      expect(container.width).toBeUndefined();
      expect(container.maxWidth).toBeUndefined();
      const backdrop = StyleSheet.flatten(view.byTestId('briefing-sheet-backdrop').props.style);
      expect(backdrop).toMatchObject({ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 });
      expect(backdrop.backgroundColor).toBe(BACKDROP_COLOR);
      expect(BACKDROP_COLOR).toBe('rgba(0,0,0,0.3)');
      expect(view.text()).toContain('sheet content');
    });

    it('draws nothing once dismissed, and back dismisses', async () => {
      const onDismiss = jest.fn();
      const add = jest.spyOn(BackHandler, 'addEventListener');
      await present(true, onDismiss);
      const handler = add.mock.calls.at(-1)?.[1];
      expect((handler as () => boolean | null | undefined)()).toBe(true);
      expect(onDismiss).toHaveBeenCalledTimes(1);
      const hidden = await present(false);
      expect(hidden.all((n) => n.props.testID === 'briefing-sheet-overlay')).toHaveLength(0);
      expect(hidden.text()).not.toContain('sheet content');
    });
  });

  describe('on iOS', () => {
    beforeEach(() => jest.replaceProperty(Platform, 'OS', 'ios'));

    it('keeps the native page sheet: full detent, grouped background, presentationSizing page', async () => {
      const onDismiss = jest.fn();
      const view = await present(true, onDismiss);
      expect(view.all((n) => n.props.testID === 'briefing-sheet-overlay')).toHaveLength(0);
      const sheet = view.byTestId('native-bottom-sheet');
      expect(sheet.props).toMatchObject({
        isPresented: true,
        onDismiss,
        snapPoints: ['full'],
        containerColor: '#F2F2F7',
        modifiers: [{ $type: 'presentationSizing', sizing: 'page' }],
      });
      expect(view.text()).toContain('sheet content');
    });
  });

  it('keeps the BottomSheet on the web preview, without the iOS-only modifier', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const view = await present();
    expect(view.byTestId('native-bottom-sheet').props.modifiers).toBeUndefined();
  });
});
