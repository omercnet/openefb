import { useMemo, useSyncExternalStore } from 'react';
import { diagramSources, type DiagramSources } from '../../domain/diagram/layers';
import type { DiagramOverlayController, DiagramOverlaySnapshot } from '../../domain/diagram/overlayController';

/** The overlay as an external store, plus the sources/overrides the surface takes (`sources`, `imageSources`, `overrides`). */
export function useDiagramOverlay(controller: DiagramOverlayController): {
  snapshot: DiagramOverlaySnapshot;
  sources: DiagramSources;
  overrides: { visibility: Record<string, boolean>; paint: Record<string, never> };
} {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const sources = useMemo(() => diagramSources(snapshot), [snapshot]);
  const overrides = useMemo(() => ({ visibility: sources.visibility, paint: {} }), [sources]);
  return { snapshot, sources, overrides };
}
