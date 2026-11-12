// DiagramPackSource (domain/diagram/overlayController.ts) over S1c's installed Israel diagram pack (`il-diagrams`). Only
// georeferenced aerodromes are drawn; the georeference is decoded and validated by S1c (`loadGeoreference`), and the image
// corners come from `clipCornersForImageSource` (TL, TR, BR, BL as [lon, lat]). A sheet-only or unreadable diagram is
// "unavailable": a wrong overlay is worse than none.
//
// The US has no precomputed pack yet (S1c ships only `il-diagrams`; owner decision Q6 moves US georeferencing offline too),
// so US candidates are empty and no US diagram is drawn until that pack exists.
import type { Coordinate, Region } from '../domain/core';
import type { DiagramCandidate, DiagramLookup, DiagramPackSource } from '../domain/diagram/overlayController';
import type { IsraelAviationDatabase } from '../data/aviation';
import { clipCornersForImageSource } from '../services/charts/diagramGeoreference';
import { loadGeoreference, type IsraelDiagramPack } from '../services/charts/diagramPack';
import type { ChartFileSystem } from '../services/charts/ports';
import { fileUri } from './terminalPdfSource';

export interface IsraelDiagramSourceDeps {
  /** The installed pack, or null (not downloaded, not published, or another edition). Called per lookup so a new edition is seen. */
  loadPack: () => Promise<IsraelDiagramPack | null>;
  fs: ChartFileSystem;
  israel: Pick<IsraelAviationDatabase, 'aerodrome'>;
  log?: (message: string) => void;
}

export function createIsraelDiagramSource(deps: IsraelDiagramSourceDeps): DiagramPackSource {
  return {
    /**
     * Every aerodrome of the pack with a drawable diagram, located through the Israel database (Swift
     * `georeferencedAerodromes`). The radius is ignored on purpose: Swift offered the nearest few of the whole pack, and
     * the controller sorts by distance and takes the nearest three. One unreadable aerodrome row never hides the rest.
     */
    async candidates(region: Region, _center: Coordinate, _radiusNM: number): Promise<DiagramCandidate[]> {
      if (region !== 'israel') return [];
      const pack = await deps.loadPack();
      if (!pack) return [];
      const out: DiagramCandidate[] = [];
      for (const icao of pack.georeferencedICAOs) {
        try {
          const a = await deps.israel.aerodrome(icao);
          if (a) out.push({ icao, position: { lat: a.latitude, lon: a.longitude } });
        } catch (e) {
          deps.log?.(`Aerodrome ${icao} lookup failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      return out;
    },

    async diagramFor(region: Region, icao: string): Promise<DiagramLookup> {
      if (region !== 'israel') return { kind: 'unavailable', reason: 'no georeferenced diagram pack for this region' };
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
      return {
        kind: 'ready',
        image: { icao, imageUri: fileUri(loaded.imagePath), coordinates },
      };
    },
  };
}
