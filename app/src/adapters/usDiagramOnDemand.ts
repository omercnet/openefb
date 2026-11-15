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
import { AppFailure } from '../domain/errors';
import { regionName, type ChartPackServiceLike } from '../services/charts/chartPackService';
import { clipCornersForImageSource, decodeGeoreference } from '../services/charts/diagramGeoreference';
import {
  decodeDiagramIndex,
  US_DIAGRAM_PRODUCT,
  type DiagramIndex,
  type IsraelDiagramPack,
} from '../services/charts/diagramPack';
import { isServable, type ChartManifest } from '../services/charts/manifest';
import type { ChartFileSystem } from '../services/charts/ports';
import { Sha256 } from '../services/charts/sha256';
import { fileUri } from './terminalPdfSource';
import { createUsDiagramSource } from './usDiagramSource';

const CURRENT_FILE = 'current.json';
const INDEX_FILE = 'index.json';
// Declared sizes are the host's word: refuse anything beyond what these files can honestly be before downloading or reading
// them into memory (the whole-cycle index is about 150 KiB, a georeference about 1 KiB, a diagram image under 1 MiB).
const INDEX_MAX_BYTES = 4 * 1024 * 1024;
const GEOREFERENCE_MAX_BYTES = 256 * 1024;
const IMAGE_MAX_BYTES = 16 * 1024 * 1024;

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
  // One read of the installed pack per call, so a pack removed in between cannot leave a call with neither source.
  const fromPack = (pack: IsraelDiagramPack) =>
    createUsDiagramSource({ loadPack: async () => pack, fs, aviation: deps.aviation, log: deps.log });

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
      // Without a signal the cached cycle serves, but only under the same published-edition gate as the online path.
      const stored = await storedManifest();
      if (stored && isServable(stored, deps.allowUnpublished?.() ?? false)) return stored;
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

  const verified = new Set<string>();
  // Anything the edition or the disk cannot give is a failed load (machine-readable like the chart service's), retried later.
  const failed = () => new AppFailure({ kind: 'chartDownloadFailed', region: regionName(US_DIAGRAM_PRODUCT) });

  /** Rejects when the file cannot be read: only a confirmed mismatch may delete a cached file. */
  async function sha256Of(path: string): Promise<string> {
    const hasher = new Sha256();
    await fs.hashFile(path, hasher);
    return hasher.digestHex();
  }

  /** A file of the edition in the cache: reused when its size matches, else downloaded and verified. */
  async function cached(manifest: ChartManifest, name: string, maxBytes: number): Promise<string | null> {
    const file = manifest.files.find((f) => f.name === name);
    if (!file || file.bytes > maxBytes) return null;
    const dir = fs.join(cacheDir, manifest.edition);
    const path = fs.join(dir, name);
    if (fs.size(path) === file.bytes) {
      // The size is only a pre-check: a file is trusted once per launch, after its SHA-256 matches the manifest.
      if (verified.has(path)) return path;
      if ((await sha256Of(path)) === file.sha256.toLowerCase()) {
        verified.add(path);
        return path;
      }
      await fs.remove(path).catch(() => undefined); // altered or damaged: fetch it again
    }
    const fresh = await service.downloadFile(manifest, name, dir);
    verified.add(fresh);
    return fresh;
  }

  async function load(): Promise<Edition | null> {
    const manifest = await currentManifest();
    if (!manifest) return null;
    const path = await cached(manifest, INDEX_FILE, INDEX_MAX_BYTES);
    if (!path) throw failed();
    const text = await fs.readText(path);
    if (text === null) throw failed();
    const index = decodeDiagramIndex(text);
    if (index.product !== US_DIAGRAM_PRODUCT || index.edition !== manifest.edition) {
      throw failed();
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
      const pack = await deps.loadPack();
      if (pack) return fromPack(pack).candidates(region, center, radiusNM);
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
      const pack = await deps.loadPack();
      if (pack) return fromPack(pack).diagramFor(region, icao);
      const resolved = await resolve(); // rejects on a network failure: the controller retries later
      if (!resolved) return { kind: 'unavailable', reason: 'no US diagram pack published' };
      const key = icao.toUpperCase();
      const record = Object.prototype.hasOwnProperty.call(resolved.index.aerodromes, key)
        ? resolved.index.aerodromes[key]
        : undefined;
      if (!record || !record.georeferenced || record.image === null || record.georeference === null) {
        return { kind: 'unavailable', reason: 'not georeferenced' };
      }
      // The georeference first: a malformed one costs no image download.
      const jsonPath = await cached(resolved.manifest, record.georeference, GEOREFERENCE_MAX_BYTES);
      if (!jsonPath) return { kind: 'unavailable', reason: 'not in the edition' };
      // A failed read rejects (the controller retries); only content that does not decode is final.
      const text = await fs.readText(jsonPath);
      if (text === null) throw failed();
      let georeference;
      try {
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
      const imagePath = await cached(resolved.manifest, record.image, IMAGE_MAX_BYTES);
      if (!imagePath) return { kind: 'unavailable', reason: 'not in the edition' };
      return { kind: 'ready', image: { icao: key, imageUri: fileUri(imagePath), coordinates } };
    },
  };
}
