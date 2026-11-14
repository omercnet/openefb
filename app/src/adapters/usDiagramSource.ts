// DiagramPackSource (domain/diagram/overlayController.ts) over the installed US diagram pack (`us-diagrams`, M5; built by
// tools/apd-georef --pack, owner decision Q6: georeferenced offline, never on the device). Same pack format as the Israel
// one, so the image and corners come from the same S1c code. Only airports the pack placed are drawn; the rest of the
// 925 FAA diagrams failed the 50 ft gate and are not in the pack.
import type { Coordinate, Region } from '../domain/core';
import type { DiagramCandidate, DiagramLookup, DiagramPackSource } from '../domain/diagram/overlayController';
import type { AviationDatabase } from '../data/aviation';
import { clipCornersForImageSource } from '../services/charts/diagramGeoreference';
import { loadGeoreference, type IsraelDiagramPack } from '../services/charts/diagramPack';
import type { ChartFileSystem } from '../services/charts/ports';
import { fileUri } from './terminalPdfSource';

export interface UsDiagramSourceDeps {
  /** The installed pack, or null (not downloaded, not published, or another edition). Called per lookup so a new edition is seen. */
  loadPack: () => Promise<IsraelDiagramPack | null>;
  fs: ChartFileSystem;
  aviation: Pick<AviationDatabase, 'airportsNear'>;
  log?: (message: string) => void;
}

export function createUsDiagramSource(deps: UsDiagramSourceDeps): DiagramPackSource {
  return {
    /** Database airports within the radius that have a drawable diagram in the pack. A database error rejects (retried later). */
    async candidates(region: Region, center: Coordinate, radiusNM: number): Promise<DiagramCandidate[]> {
      if (region !== 'us') return [];
      const pack = await deps.loadPack();
      if (!pack) return [];
      const drawable = new Set(pack.georeferencedICAOs);
      if (drawable.size === 0) return [];
      const airports = await deps.aviation.airportsNear(center, radiusNM);
      return airports
        .filter((a) => drawable.has(a.icao))
        .map((a) => ({ icao: a.icao, position: { lat: a.latitude, lon: a.longitude } }));
    },

    async diagramFor(region: Region, icao: string): Promise<DiagramLookup> {
      if (region !== 'us') return { kind: 'unavailable', reason: 'not a US diagram' };
      const pack = await deps.loadPack();
      if (!pack) return { kind: 'unavailable', reason: 'diagram pack not installed' };
      if (pack.availability(icao).kind !== 'georeferenced') return { kind: 'unavailable', reason: 'not georeferenced' };
      const loaded = await loadGeoreference(pack, deps.fs, icao, deps.log);
      if (!loaded) return { kind: 'unavailable', reason: 'georeference unreadable' };
      if (!deps.fs.exists(loaded.imagePath)) return { kind: 'unavailable', reason: 'diagram image missing' };
      const coordinates = clipCornersForImageSource(loaded.georeference);
      // Four finite [lon, lat] pairs, or nothing: a malformed quad must never reach the renderer.
      if (coordinates.length !== 4 || !coordinates.every((c) => c.length === 2 && c.every(Number.isFinite))) {
        return { kind: 'unavailable', reason: 'invalid corners' };
      }
      return { kind: 'ready', image: { icao, imageUri: fileUri(loaded.imagePath), coordinates } };
    },
  };
}
