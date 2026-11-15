import type { ReactNode } from 'react';
import { Linking } from 'react-native';
import { render } from '../../../tests/support/ui';
import type { IsraelNotam } from '../../domain/israel/notamTypes';
import type { BriefingActions, IsraelBriefingViewModel } from '../sheets/briefing/store';
import { LiveBriefing, type LiveBriefingProps } from './LiveBriefing';

let sheet: { model: IsraelBriefingViewModel; actions: BriefingActions } | null = null;
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('../sheets/briefing/BriefingPresentation', () => ({
  BriefingPresentation: ({ presented, children }: { presented: boolean; children: ReactNode }) =>
    presented ? children : null,
}));
jest.mock('../sheets/briefing/IsraelBriefingSheet', () => ({
  IsraelBriefingSheet: (props: NonNullable<typeof sheet>) => {
    sheet = props;
    return null;
  },
}));

const points: Record<string, { lat: number; lon: number }> = {
  AAA: { lat: 32, lon: 34.8 },
  BBB: { lat: 32.2, lon: 35 },
};
const props = (over: Partial<LiveBriefingProps> = {}): LiveBriefingProps => ({
  fetcher: jest.fn(async () => {
    throw new Error('unused');
  }),
  readStore: {
    isRead: () => false,
    markRead: () => undefined,
    markUnread: () => undefined,
    markAllRead: () => undefined,
  },
  ownship: { lat: 32.1, lon: 34.9 },
  pointLookup: (code) => points[code] ?? null,
  presented: true,
  onDismiss: jest.fn(),
  onShow: jest.fn(),
  onClear: jest.fn(),
  ...over,
});
const notam = (over: Record<string, unknown>) =>
  ({ geometry: { polygon: null, circle: null }, q: null, closures: [], ...over }) as unknown as IsraelNotam;

beforeEach(() => {
  sheet = null;
});

describe('LiveBriefing', () => {
  it('shows nothing while not presented', async () => {
    await render(<LiveBriefing {...props({ presented: false })} />);
    expect(sheet).toBeNull();
  });

  it('presents the sheet on a fresh model that knows the ownship and no route', async () => {
    await render(<LiveBriefing {...props()} />);
    expect(sheet!.model.store.getState()).toMatchObject({
      route: null,
      ownship: { lat: 32.1, lon: 34.9 },
      report: null,
    });
  });

  it('Show on map hands the highlight to the map, or says there is nothing to draw', async () => {
    const p = props();
    await render(<LiveBriefing {...p} />);
    expect(sheet!.actions.showOnMap(notam({ closures: [{ chain: ['AAA', 'BBB'] }] }), 'closure')).toBe(true);
    expect(p.onShow).toHaveBeenCalledWith(
      expect.objectContaining({ bounds: { south: 32, west: 34.8, north: 32.2, east: 35 } }),
    );
    expect(sheet!.actions.showOnMap(notam({}), 'info')).toBe(false);
    expect(p.onShow).toHaveBeenCalledTimes(1);
  });

  it('Done, clear and links go to the app and the system', async () => {
    const p = props();
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    await render(<LiveBriefing {...p} />);
    sheet!.actions.dismiss();
    sheet!.actions.clearHighlight();
    sheet!.actions.openURL('https://example.org');
    expect(p.onDismiss).toHaveBeenCalled();
    expect(p.onClear).toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith('https://example.org');
    open.mockRestore();
  });
});
