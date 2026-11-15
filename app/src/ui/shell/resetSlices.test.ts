import { appStore } from '../state/appStore';
import { resetLiveSlices } from './resetSlices';

describe('resetLiveSlices', () => {
  it('returns the screen state to the map launch state: no Log, no overlay, no sheets', () => {
    appStore.setState({
      selectedScreen: 'log',
      overlay: { kind: 'planner' } as never,
      isPresentingBriefing: true,
      chartViewer: {} as never,
    });
    resetLiveSlices('israel');
    const state = appStore.getState();
    expect(state.selectedScreen).toBe('map');
    expect(state.overlay).toBeNull();
    expect(state.isPresentingBriefing).toBe(false);
    expect(state.chartViewer).toBeNull();
  });
});
