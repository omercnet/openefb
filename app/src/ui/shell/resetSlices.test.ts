import { appStore } from '../state/appStore';
import { resetLiveSlices } from './resetSlices';

describe('resetLiveSlices', () => {
  it('returns the screen state to the map launch state: no Log, no overlay, no sheets', () => {
    appStore.setState({
      selectedScreen: 'log',
      overlay: { kind: 'planner' } as never,
      mapBounds: { south: 1, west: 2, north: 3, east: 4 },
      mapFrameRequest: { seq: 3, box: { south: 1, west: 2, north: 3, east: 4 } },
      isPresentingBriefing: true,
      chartViewer: {} as never,
    });
    resetLiveSlices('israel');
    const state = appStore.getState();
    expect(state.selectedScreen).toBe('map');
    expect(state.overlay).toBeNull();
    expect(state.mapBounds).toBeNull();
    expect(state.mapFrameRequest).toBeNull();
    expect(state.isPresentingBriefing).toBe(false);
    expect(state.chartViewer).toBeNull();
  });
});
