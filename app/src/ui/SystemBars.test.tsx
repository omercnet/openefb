import type { ReactElement } from 'react';
import { StatusBar, StyleSheet, type ViewStyle } from 'react-native';
import { SafeAreaProvider, type EdgeInsets } from 'react-native-safe-area-context';
import { render, type Rendered } from '../../tests/support/ui';
import RootLayout from '../app/_layout';
import { CompactMapLayout } from './CompactMapLayout';
import { appStore } from './state/appStore';
import { chromeInsets, FALLBACK_INSETS, StripColumn, type StripScreen } from './StripColumn';
import { DefaultStatusBar, statusBarStyleFor } from './SystemBars';
import { Day, Night, StripMetrics } from './tokens';

// The route the root layout's Slot shows: set per test.
let mockRoute: () => ReactElement | null = () => null;
jest.mock('expo-router', () => ({ Slot: () => mockRoute() }));

// React Native keeps the mounted bars on a private static stack and has no public getter for the merged style.
const statusBarInternals = StatusBar as unknown as { _propsStack: { barStyle?: { value: string } }[] };
/** The bar style React Native applies: the most recently mounted StatusBar's entry wins. */
const shownBarStyle = (): string | undefined =>
  statusBarInternals._propsStack.filter((e) => e.barStyle != null).at(-1)?.barStyle?.value;

const insets = (edges: Partial<EdgeInsets>): EdgeInsets => ({ top: 0, right: 0, bottom: 0, left: 0, ...edges });
const provided = (edges: EdgeInsets, child: ReactElement) => (
  <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 1032, height: 1376 }, insets: edges }}>
    {child}
  </SafeAreaProvider>
);

type Layout = 'strip column' | 'compact layout';
const layout = (kind: Layout, screen?: StripScreen) =>
  kind === 'strip column' ? (
    <StripColumn screen={screen} width={400} />
  ) : (
    <CompactMapLayout screen={screen} width={390} compact chart={null} />
  );

/** The inset the footer pads for: the NRST cell runs down through it (StripMetrics.cell + bottomInset). */
const footerBottomInset = (view: Rendered): number => {
  const style = StyleSheet.flatten(view.byTestId('NRST').props.style) as ViewStyle;
  expect(style.height).toBe(StripMetrics.cell + Number(style.paddingBottom));
  return Number(style.paddingBottom);
};

beforeEach(() => appStore.setState({ stripColumn: 'log', selectedAirportId: null }));

describe('status bar style', () => {
  it('is dark content on the Day palette and light content on the Night palette', () => {
    expect(statusBarStyleFor(Day)).toBe('dark');
    expect(statusBarStyleFor(Night)).toBe('light');
  });

  it.each(['strip column', 'compact layout'] as const)('the %s sets it from its palette', async (kind) => {
    const day = await render(provided(insets({ top: 24, bottom: 48 }), layout(kind, 'map')));
    expect(shownBarStyle()).toBe('dark-content');
    await day.unmount();
    await render(provided(insets({ top: 24, bottom: 48 }), layout(kind, 'night')));
    expect(shownBarStyle()).toBe('light-content');
  });

  it('defaults to dark content for the light screens (forms, sheets, settings) at the root', async () => {
    mockRoute = () => null;
    await render(<RootLayout />);
    expect(shownBarStyle()).toBe('dark-content');
  });

  it("lets a night route's bar win over the root default, and falls back to it when the route goes", async () => {
    mockRoute = () => provided(insets({ top: 24, bottom: 48 }), <StripColumn screen="night" width={400} />);
    const view = await render(<RootLayout />);
    expect(shownBarStyle()).toBe('light-content');
    mockRoute = () => null;
    await view.update(<RootLayout />);
    expect(shownBarStyle()).toBe('dark-content');
  });

  it('a later screen bar wins over an earlier default sibling', async () => {
    await render(
      <>
        <DefaultStatusBar />
        {provided(insets({ top: 24, bottom: 48 }), <CompactMapLayout screen="night" width={390} compact chart={null} />)}
      </>,
    );
    expect(shownBarStyle()).toBe('light-content');
  });
});

describe('footer bottom inset', () => {
  it.each(['strip column', 'compact layout'] as const)("the %s pads for the provider's bottom inset", async (kind) => {
    // A 3-button Android navigation bar (48), a gesture bar (24), the iPad home indicator (20).
    for (const bottom of [48, 24, 20]) {
      const view = await render(provided(insets({ top: 24, bottom }), layout(kind)));
      expect(footerBottomInset(view)).toBe(bottom);
      await view.unmount();
    }
  });

  it.each(['strip column', 'compact layout'] as const)(
    'the %s keeps a reported 0 (no navigation bar) instead of the fallback',
    async (kind) => {
      const view = await render(provided(insets({ top: 24, bottom: 0 }), layout(kind)));
      expect(footerBottomInset(view)).toBe(0);
    },
  );

  it.each(['strip column', 'compact layout'] as const)(
    'the %s uses the fallback only when the provider reports no inset at all',
    async (kind) => {
      const view = await render(provided(insets({}), layout(kind)));
      expect(footerBottomInset(view)).toBe(FALLBACK_INSETS.bottom);
    },
  );
});

describe('chromeInsets', () => {
  it('passes the reported top and bottom through, edge by edge', () => {
    expect(chromeInsets(insets({ top: 32, bottom: 20 }))).toEqual({ top: 32, bottom: 20 });
    expect(chromeInsets(insets({ top: 0, bottom: 21, left: 59, right: 59 }))).toEqual({ top: 0, bottom: 21 });
  });

  it('falls back to the reference iPad only with no inset on any edge', () => {
    expect(chromeInsets(insets({}))).toEqual(FALLBACK_INSETS);
  });
});
