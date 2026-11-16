import { act } from 'react';
import { render } from '../../../tests/support/ui';
import type { Region } from '../../domain/core';
import type { DiagramPackSource } from '../../domain/diagram/overlayController';
import { useAirportDiagrams } from './useAirportDiagrams';

const view = (zoom: number) => ({
  center: { lat: 32, lon: 34.8 },
  zoom,
  bearing: 0,
  northEast: { lat: 32.01, lon: 34.81 },
  southWest: { lat: 31.99, lon: 34.79 },
  userInteraction: false,
  animated: false,
});

function harness(over: { region: Region; remoteDisabled?: boolean; packs?: NonNullable<Parameters<typeof useAirportDiagrams>[0]['packs']> }) {
  const source: DiagramPackSource = { candidates: jest.fn(async () => []), diagramFor: jest.fn() };
  const remoteListeners = new Set<() => void>();
  const remote = {
    isDisabled: () => over.remoteDisabled === true,
    subscribe: (l: () => void) => (remoteListeners.add(l), () => void remoteListeners.delete(l)),
  };
  let api!: ReturnType<typeof useAirportDiagrams>;
  const Probe = () => {
    api = useAirportDiagrams({
      source,
      region: over.region,
      enabled: () => true,
      subscribeEnabled: () => () => undefined,
      packs: over.packs,
      remote,
    });
    return null;
  };
  return { source, remote, remoteListeners, Probe, get api() { return api; } };
}

describe('useAirportDiagrams', () => {
  it('asks the source for the current region once the camera is close', async () => {
    const h = harness({ region: 'israel' });
    await render(<h.Probe />);
    await act(async () => h.api.onCamera(view(15)));
    expect(h.source.candidates).toHaveBeenCalledWith('israel', { lat: 32, lon: 34.8 }, expect.any(Number));
    expect(h.api.snapshot.visible).toBe(true);
  });

  it('the remote kill switch hides the Israel overlay', async () => {
    const h = harness({ region: 'israel', remoteDisabled: true });
    await render(<h.Probe />);
    await act(async () => h.api.onCamera(view(15)));
    expect(h.source.candidates).not.toHaveBeenCalled();
    expect(h.api.snapshot.visible).toBe(false);
  });

  it('the kill switch is the Israel overlay only: the FAA diagrams still show', async () => {
    const h = harness({ region: 'us', remoteDisabled: true });
    await render(<h.Probe />);
    await act(async () => h.api.onCamera(view(15)));
    expect(h.source.candidates).toHaveBeenCalledWith('us', expect.anything(), expect.any(Number));
    expect(h.api.snapshot.visible).toBe(true);
  });

  it('a change of the remote configuration is read again', async () => {
    const h = harness({ region: 'israel' });
    await render(<h.Probe />);
    await act(async () => h.api.onCamera(view(15)));
    expect(h.api.snapshot.visible).toBe(true);
    h.remote.isDisabled = () => true;
    await act(async () => h.remoteListeners.forEach((l) => l()));
    expect(h.api.snapshot.visible).toBe(false);
  });

  it('a pack installed or replaced in Settings drops what was loaded and asks the source again; progress ticks do not', async () => {
    let edition: string | null = null;
    const listeners = new Set<() => void>();
    const pack = { subscribe: (l: () => void) => (listeners.add(l), () => void listeners.delete(l)), edition: () => edition };
    const h = harness({ region: 'israel', packs: [pack] });
    await render(<h.Probe />);
    await act(async () => h.api.onCamera(view(15)));
    expect(h.source.candidates).toHaveBeenCalledTimes(1);
    await act(async () => listeners.forEach((l) => l())); // a download progress tick: same edition (none)
    expect(h.source.candidates).toHaveBeenCalledTimes(1);
    edition = '2026-02';
    await act(async () => listeners.forEach((l) => l()));
    expect(h.source.candidates).toHaveBeenCalledTimes(2);
    edition = null; // removed
    await act(async () => listeners.forEach((l) => l()));
    expect(h.source.candidates).toHaveBeenCalledTimes(3);
  });
});
