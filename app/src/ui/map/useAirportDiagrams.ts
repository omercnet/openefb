// Airport diagrams on the live map (AirportDiagramOverlay.swift): the overlay controller on the chart packs, kept in step with
// the region, the Layers switch and the remote kill switch, fed by the camera. FAA diagrams come on demand (or from an
// installed pack), CAAI diagrams from the installed `il-diagrams` pack. The controller itself is domain/diagram.
import { useCallback, useEffect, useMemo } from 'react';
import type { Region } from '../../domain/core';
import { DiagramOverlayController, type DiagramPackSource } from '../../domain/diagram/overlayController';
import { useDiagramOverlay } from './useDiagramOverlay';
import type { MapViewChange } from './MapSurface';

export interface AirportDiagramsDeps {
  source: DiagramPackSource;
  region: Region;
  /** The Layers switch (AirportDiagramOverlay.isEnabled). */
  enabled: () => boolean;
  subscribeEnabled: (listener: () => void) => () => void;
  /** The remote kill switch of the Israel overlay; null without remote config. */
  remote: { isDisabled(feature: 'israelDiagramOverlay'): boolean; subscribe(listener: () => void): () => void } | null;
}

export function useAirportDiagrams(deps: AirportDiagramsDeps) {
  const { source, region, enabled, subscribeEnabled, remote } = deps;
  const controller: DiagramOverlayController = useMemo(
    () =>
      new DiagramOverlayController({
        source,
        enabled,
        // The kill switch is the Israel overlay's; the FAA diagrams have none.
        remotelyDisabled: () => controller.currentRegion === 'israel' && (remote?.isDisabled('israelDiagramOverlay') ?? false),
      }),
    // One controller per source: the region and the switches are read live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source],
  );
  useEffect(() => {
    void controller.setRegion(region);
  }, [controller, region]);
  useEffect(() => {
    const stops = [subscribeEnabled(() => void controller.refresh()), remote?.subscribe(() => void controller.refresh())];
    return () => stops.forEach((stop) => stop?.());
  }, [controller, subscribeEnabled, remote]);
  useEffect(() => () => controller.dispose(), [controller]);
  const view = useDiagramOverlay(controller);
  const onCamera = useCallback(
    (change: MapViewChange) =>
      void controller.onCamera({
        center: change.center,
        zoom: change.zoom,
        northEast: change.northEast,
        southWest: change.southWest,
      }),
    [controller],
  );
  return { ...view, onCamera };
}
