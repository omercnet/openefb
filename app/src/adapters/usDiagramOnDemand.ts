// US airport diagrams on demand (M5b). Swift (AirportDiagramOverlay.load) fetched each airport's diagram when the map
// showed it, cached it per chart cycle, took "no diagram / rejected" as final and a load error as "try again later". Here
// the diagrams are the offline `us-diagrams` edition of the cycle (tools/apd-georef --pack, owner decision Q6), served as
//   <base>/us-diagrams/manifest.json                product index (latest published edition = the d-TPP cycle)
//   <base>/us-diagrams/<cycle>/manifest.json        sha256 and size of every file
//   <base>/us-diagrams/<cycle>/index.json           which airports have a diagram
//   <base>/us-diagrams/<cycle>/<ICAO>.png, .json    one airport's image and georeference
// so the app downloads the manifest and index once, then only the two files of an airport in view (about 220 KiB), each
// verified against the manifest. An installed full pack (the optional offline download) is preferred and needs no network.
//
// Cache: <cacheDir>/<cycle>/ and <cacheDir>/current.json (the cycle's manifest, for use without a signal). It is NOT the
// pack's install folder: installing a full pack clears that folder. One cycle is kept; a new one replaces it.
//
// Errors: `diagramFor` REJECTS on a network or checksum failure (the overlay controller retries after 5 minutes) and
// resolves "unavailable" only when the edition has no usable diagram for the airport. After a failure with nothing cached,
// the edition is not asked for again for `retryAfterMs`, so a camera that moves does not hammer a dead connection.
import { distanceNm, type Coordinate, type Region } from '../domain/core';
import {
  DIAGRAM_RETRY_AFTER_MS,
  type DiagramCandidate,
  type DiagramLookup,
  type DiagramPackSource,
} from '../domain/diagram/overlayController';
import type { AviationDatabase } from '../data/aviation';
import type { ChartPackServiceLike } from '../services/charts/chartPackService';
import { clipCornersForImageSource, decodeGeoreference } from '../services/charts/diagramGeoreference';
import {
  decodeDiagramIndex,
  US_DIAGRAM_PRODUCT,
  type DiagramIndex,
  type IsraelDiagramPack,
} from '../services/charts/diagramPack';
import type { ChartManifest } from '../services/charts/manifest';
import type { ChartFileSystem } from '../services/charts/ports';
import { fileUri } from './terminalPdfSource';
import { createUsDiagramSource } from './usDiagramSource';

const CURRENT_FILE = 'current.json';
const INDEX_FILE = 'index.json';

export interface OnDemandUsDiagramDeps {
  /** The `us-diagrams` product service: latest edition and per-file downloads. */
  service: ChartPackServiceLike;
  fs: ChartFileSystem;
  /** Cache folder; must not be the chart pack's install folder. */
  cacheDir: string;
  /** The installed full pack, or null. Preferred whenever it is present. */
  loadPack: () => Promise<IsraelDiagramPack | null>;
  aviation: Pick<AviationDatabase, 'airportsNear'>;
  /** Developer setting; the caller must return false in release builds. */
  allowUnpublished?: () => boolean;
  now?: () => number;
  retryAfterMs?: number;
  log?: (message: string) => void;
}

interface Edition {
  manifest: ChartManifest;
  index: DiagramIndex;
}

const isStoredManifest = (m: unknown): m is ChartManifest =>
  typeof m === 'object' &&
  m !== null &&
  typeof (m as ChartManifest).edition === 'string' &&
  Array.isArray((m as ChartManifest).files) &&
  (m as ChartManifest).files.every(
    (f) => typeof f?.name === 'string' && typeof f.bytes === 'number' && typeof f.sha256 === 'string',
  );

export function createOnDemandUsDiagramSource(deps: OnDemandUsDiagramDeps): DiagramPackSource {
  const { service, fs, cacheDir } = deps;
  const now = deps.now ?? Date.now;
  const retryAfterMs = deps.retryAfterMs ?? DIAGRAM_RETRY_AFTER_MS;
  const fromPack = createUsDiagramSource({ loadPack: deps.loadPack, fs, aviation: deps.aviation, log: deps.log });

  let edition: Promise<Edition | null> | null = null; // null result: nothing published
  let failedAt: number | null = null;
  let failure: unknown = null;

  async function storedManifest(): Promise<ChartManifest | null> {
    try {
      const text = await fs.readText(fs.join(cacheDir, CURRENT_FILE));
      const parsed: unknown = text === null ? null : JSON.parse(text);
      return isStoredManifest(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  /** The latest published edition: from the host, else the cached one (no signal). */
  async function currentManifest(): Promise<ChartManifest | null> {
    let latest: ChartManifest | null;
    try {
      latest = await service.latestServable(deps.allowUnpublished?.() ?? false);
    } catch (error) {
      const cached = await storedManifest();
      if (cached) return cached;
      throw error;
    }
    if (!latest) return null;
    const cached = await storedManifest();
    if (cached?.edition !== latest.edition) {
      // A new cycle: keep only it. Removing first means a crash leaves an empty cache, never a mixed one.
      for (const entry of await fs.list(cacheDir)) await fs.remove(fs.join(cacheDir, entry)).catch(() => undefined);
      await fs.writeText(fs.join(cacheDir, CURRENT_FILE), JSON.stringify(latest));
      await fs.excludeFromBackup?.(cacheDir).catch(() => undefined); // re-downloadable
    }
    return latest;
  }

  /** A file of the edition in the cache: reused when its size matches, else downloaded and verified. */
  async function cached(manifest: ChartManifest, name: string): Promise<string | null> {
    const file = manifest.files.find((f) => f.name === name);
    if (!file) return null;
    const dir = fs.join(cacheDir, manifest.edition);
    const path = fs.join(dir, name);
    if (fs.size(path) === file.bytes) return path;
    return service.downloadFile(manifest, name, dir);
  }

  async function load(): Promise<Edition | null> {
    const manifest = await currentManifest();
    if (!manifest) return null;
    const path = await cached(manifest, INDEX_FILE);
    if (!path) throw new Error(`edition ${manifest.edition} has no ${INDEX_FILE}`);
    const text = await fs.readText(path);
    if (text === null) throw new Error(`${INDEX_FILE} is unreadable`);
    const index = decodeDiagramIndex(text);
    if (index.product !== US_DIAGRAM_PRODUCT || index.edition !== manifest.edition) {
      throw new Error(`${INDEX_FILE} does not belong to edition ${manifest.edition}`);
    }
    return { manifest, index };
  }

  /** Resolved once; a failure is remembered for `retryAfterMs` and then retried. */
  function resolve(): Promise<Edition | null> {
    if (edition) return edition;
    if (failedAt !== null && now() - failedAt < retryAfterMs) return Promise.reject(failure);
    const attempt = load().catch((error: unknown) => {
      edition = null;
      failedAt = now();
      failure = error;
      throw error;
    });
    edition = attempt;
    return attempt;
  }

  return {
    async candidates(region: Region, center: Coordinate, radiusNM: number): Promise<DiagramCandidate[]> {
      if (region !== 'us') return [];
      if (await deps.loadPack()) return fromPack.candidates(region, center, radiusNM);
      let resolved: Edition | null;
      try {
        resolved = await resolve();
      } catch (error) {
        deps.log?.(`US diagram index unavailable: ${error instanceof Error ? error.message : String(error)}`);
        return []; // nothing known to draw yet; the index is asked for again after the retry window
      }
      if (!resolved) return [];
      const airports = await deps.aviation.airportsNear(center, radiusNM);
      return airports
        .filter(
          (a) =>
            a.type === 'airport' &&
            distanceNm(center, { lat: a.latitude, lon: a.longitude }) <= radiusNM &&
            resolved.index.aerodromes[a.icao]?.georeferenced === true,
        )
        .map((a) => ({ icao: a.icao, position: { lat: a.latitude, lon: a.longitude } }));
    },

    async diagramFor(region: Region, icao: string): Promise<DiagramLookup> {
      if (region !== 'us') return { kind: 'unavailable', reason: 'not a US diagram' };
      if (await deps.loadPack()) return fromPack.diagramFor(region, icao);
      const resolved = await resolve(); // rejects on a network failure: the controller retries later
      if (!resolved) return { kind: 'unavailable', reason: 'no US diagram pack published' };
      const key = icao.toUpperCase();
      const record = Object.prototype.hasOwnProperty.call(resolved.index.aerodromes, key)
        ? resolved.index.aerodromes[key]
        : undefined;
      if (!record || !record.georeferenced || record.image === null || record.georeference === null) {
        return { kind: 'unavailable', reason: 'not georeferenced' };
      }
      const jsonPath = await cached(resolved.manifest, record.georeference);
      const imagePath = await cached(resolved.manifest, record.image);
      if (!jsonPath || !imagePath) return { kind: 'unavailable', reason: 'not in the edition' };
      let georeference;
      try {
        const text = await fs.readText(jsonPath);
        if (text === null) return { kind: 'unavailable', reason: 'georeference unreadable' };
        georeference = decodeGeoreference(text);
      } catch (error) {
        deps.log?.(`Unreadable georeference for ${key}: ${error instanceof Error ? error.message : String(error)}`);
        return { kind: 'unavailable', reason: 'georeference unreadable' };
      }
      const coordinates = clipCornersForImageSource(georeference);
      // Four finite [lon, lat] pairs, or nothing: a malformed quad must never reach the renderer.
      if (coordinates.length !== 4 || !coordinates.every((c) => c.length === 2 && c.every(Number.isFinite))) {
        return { kind: 'unavailable', reason: 'invalid corners' };
      }
      return { kind: 'ready', image: { icao: key, imageUri: fileUri(imagePath), coordinates } };
    },
  };
}
