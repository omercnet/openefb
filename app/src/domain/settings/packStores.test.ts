import type { IsraelChartPackState, IsraelDiagramPackState } from './israelPacks';
import { createFakeChartStore, createFakeDiagramStore } from './packStores';

const chart: IsraelChartPackState = {
  status: { kind: 'notDownloaded' },
  latestLabel: null,
  offeredBytes: null,
  installedBytes: null,
  isChecking: false,
  checkFailed: false,
  downloadProgress: null,
  pausedProgress: null,
  errorMessage: null,
};

const diagrams: IsraelDiagramPackState = {
  pack: null,
  latestLabel: null,
  isChecking: false,
  downloadProgress: null,
  errorMessage: null,
  canDownload: false,
};

describe('fake pack stores', () => {
  it('the snapshot keeps its identity until the state changes (what useSyncExternalStore needs)', () => {
    const store = createFakeChartStore(chart);
    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);
    store.set({ latestLabel: '2026-01' });
    expect(store.getSnapshot()).not.toBe(first);
    expect(store.getSnapshot()).toMatchObject({ latestLabel: '2026-01', isChecking: false });
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const store = createFakeDiagramStore(diagrams);
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);
    store.set({ isChecking: true });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.set({ isChecking: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('records the actions the rows trigger, in order', async () => {
    const store = createFakeChartStore(chart);
    await store.refresh();
    store.startDownload();
    store.pauseDownload();
    store.remove();
    expect(store.calls).toEqual(['refresh', 'startDownload', 'pauseDownload', 'remove']);

    const diagramStore = createFakeDiagramStore(diagrams);
    await diagramStore.refresh();
    diagramStore.startDownload();
    expect(diagramStore.calls).toEqual(['refresh', 'startDownload']);
  });
});
