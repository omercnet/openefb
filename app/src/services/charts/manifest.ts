// Port of IsraelChartManifest.swift: wire models for the official CAAI CVFR chart pack that we convert, validate and host
// ourselves (IL-9). Hosting layout (Cloudflare R2, written by web/charts/publish.sh):
//   <base>/israel-cvfr/manifest.json            product index: latest published edition + all editions
//   <base>/israel-cvfr/<edition>/manifest.json  edition manifest: pipeline fields + published + files[]
//   <base>/israel-cvfr/<edition>/<file>         the MBTiles pack
// The chart is (c) CAAI, base map (c) Mapa Ltd. Times are epoch ms.
import {
  asObject,
  DecodeError,
  optArray,
  optDouble,
  optInt,
  optObject,
  optString,
  reqArray,
  reqBool,
  reqInt,
  reqString,
  type JsonObject,
} from '../jsonDecode';

/** Product index the app polls. */
export interface ChartIndexEntry {
  edition: string;
  published: boolean;
  publishedAt: string | null;
  validatedAt: string | null;
}

export interface ChartIndex {
  product: string;
  updatedAt: string | null;
  /** Newest published edition id, null when nothing is published. */
  latest: string | null;
  editions: ChartIndexEntry[];
}

export interface ChartManifestFile {
  name: string;
  bytes: number;
  sha256: string; // lowercase hex
  path: string | null; // relative to the public base, e.g. "israel-cvfr/2025-02/<name>"
  url: string | null; // absolute URL when the host supplies one
}

export interface ChartValidation {
  passed: boolean;
  medianM: number | null; // metres
  p95M: number | null;
  maxM: number | null;
}

/** One edition's manifest: the pipeline's fields plus the hosting fields. */
export interface ChartManifest {
  product: string;
  edition: string; // file-safe id, e.g. "2025-02"
  editionLabel: string | null; // as printed on the sheet, e.g. "Update 2/25 (October 2025)"
  published: boolean;
  publishedAt: string | null;
  validatedAt: string | null;
  validation: ChartValidation | null;
  /** west, south, east, north in degrees; chart packs only. */
  bounds: number[] | null;
  minZoom: number | null;
  maxZoom: number | null;
  files: ChartManifestFile[];
}

/** The MBTiles file of a chart pack. */
export const manifestPack = (m: ChartManifest): ChartManifestFile | null =>
  m.files.find((f) => f.name.endsWith('.mbtiles')) ?? null;

/** Human label, falling back to the edition id. */
export const manifestLabel = (m: ChartManifest): string => m.editionLabel ?? m.edition;

/** Pilots only ever get a published edition whose validation gate passed; a developer setting can override that to try
 * a build before it is approved. */
export function isServable(m: ChartManifest, allowUnpublished: boolean): boolean {
  if (m.files.length === 0) return false;
  if (allowUnpublished) return true;
  return m.published && m.validation?.passed === true;
}

/** Download size of all files. */
export const manifestTotalBytes = (m: ChartManifest): number => m.files.reduce((sum, f) => sum + f.bytes, 0);

/** What is on the device for one product. */
export interface ChartPackInstalledFile {
  name: string;
  bytes: number;
  sha256: string;
}

export interface ChartPackInstalled {
  product: string;
  edition: string;
  editionLabel: string;
  files: ChartPackInstalledFile[];
  installedAtMs: number;
}

export const installedTotalBytes = (i: ChartPackInstalled): number => i.files.reduce((sum, f) => sum + f.bytes, 0);

/** What the chart badge and the download row show. */
export type ChartStatus =
  /** No pack on the device: the street base is shown. */
  | { kind: 'notDownloaded' }
  | { kind: 'installed'; edition: string; label: string }
  | {
      kind: 'updateAvailable';
      installedEdition: string;
      installedLabel: string;
      latestEdition: string;
      latestLabel: string;
    };

/** Official pack present, so the base chart can be drawn from it. */
export const statusIsPresent = (s: ChartStatus): boolean => s.kind !== 'notDownloaded';

/** Foundation `compare(_:options: .numeric)`: runs of digits compare as numbers, everything else code point by code point
 * (case-sensitive). Negative, zero or positive. */
export function compareNumeric(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g;
  const ta = a.match(re) ?? [];
  const tb = b.match(re) ?? [];
  for (let i = 0; i < Math.min(ta.length, tb.length); i++) {
    const x = ta[i];
    const y = tb[i];
    const xd = /^\d/.test(x);
    const yd = /^\d/.test(y);
    if (xd && yd) {
      const nx = x.replace(/^0+(?=\d)/, '');
      const ny = y.replace(/^0+(?=\d)/, '');
      if (nx.length !== ny.length) return nx.length < ny.length ? -1 : 1;
      if (nx !== ny) return nx < ny ? -1 : 1;
    } else if (x !== y) {
      const cx = [...x];
      const cy = [...y];
      for (let k = 0; k < Math.min(cx.length, cy.length); k++) {
        if (cx[k] !== cy[k]) return (cx[k].codePointAt(0) ?? 0) - (cy[k].codePointAt(0) ?? 0);
      }
      if (cx.length !== cy.length) return cx.length - cy.length;
    }
  }
  return ta.length - tb.length;
}

/** Edition ids sort as year then amendment ("2025-02" < "2026-01"); numeric-aware compare. */
export const isNewerEdition = (a: string, than: string): boolean => compareNumeric(a, than) > 0;

/** Resolve from what is installed and the latest servable edition (null when offline or none). */
export function resolveChartStatus(installed: ChartPackInstalled | null, latest: ChartManifest | null): ChartStatus {
  if (!installed) return { kind: 'notDownloaded' };
  if (latest && latest.edition !== installed.edition && isNewerEdition(latest.edition, installed.edition)) {
    return {
      kind: 'updateAvailable',
      installedEdition: installed.edition,
      installedLabel: installed.editionLabel,
      latestEdition: latest.edition,
      latestLabel: manifestLabel(latest),
    };
  }
  return { kind: 'installed', edition: installed.edition, label: installed.editionLabel };
}

/** Badge copy. Never implies currency the app cannot prove. */
export function chartBadgeText(s: ChartStatus): string {
  switch (s.kind) {
    case 'notDownloaded':
      return 'Official chart not downloaded';
    case 'installed':
      return `CAAI CVFR (official) ${s.label}`;
    case 'updateAvailable':
      return `CAAI CVFR (official) ${s.installedLabel}, newer edition available`;
  }
}

// MARK: Decoding (Swift Codable semantics: required fields and wrong types reject the document)

function parse(body: string, what: string): JsonObject {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new DecodeError(`${what} is not JSON`);
  }
  return asObject(json, what);
}

export function decodeChartIndex(body: string): ChartIndex {
  const o = parse(body, 'index');
  return {
    product: reqString(o, 'product'),
    updatedAt: optString(o, 'updatedAt'),
    latest: optString(o, 'latest'),
    editions: reqArray(o, 'editions').map((e) => {
      const entry = asObject(e, 'editions[]');
      return {
        edition: reqString(entry, 'edition'),
        published: reqBool(entry, 'published'),
        publishedAt: optString(entry, 'publishedAt'),
        validatedAt: optString(entry, 'validatedAt'),
      };
    }),
  };
}

export function decodeChartManifest(body: string): ChartManifest {
  const o = parse(body, 'manifest');
  const validation = optObject(o, 'validation');
  const bounds = optArray(o, 'bounds');
  return {
    product: reqString(o, 'product'),
    edition: reqString(o, 'edition'),
    editionLabel: optString(o, 'edition_label'),
    published: reqBool(o, 'published'),
    publishedAt: optString(o, 'publishedAt'),
    validatedAt: optString(o, 'validated_at'),
    validation: validation
      ? {
          passed: reqBool(validation, 'passed'),
          medianM: optDouble(validation, 'median_m'),
          p95M: optDouble(validation, 'p95_m'),
          maxM: optDouble(validation, 'max_m'),
        }
      : null,
    bounds: bounds
      ? bounds.map((v) => {
          if (typeof v !== 'number' || !Number.isFinite(v)) throw new DecodeError('bounds: expected numbers');
          return v;
        })
      : null,
    minZoom: optInt(o, 'min_zoom'),
    maxZoom: optInt(o, 'max_zoom'),
    files: reqArray(o, 'files').map((f) => {
      const file = asObject(f, 'files[]');
      return {
        name: reqString(file, 'name'),
        bytes: reqInt(file, 'bytes'),
        sha256: reqString(file, 'sha256'),
        path: optString(file, 'path'),
        url: optString(file, 'url'),
      };
    }),
  };
}

/** `installed.json`: `{ product, edition, editionLabel, files[], installedAtMs }`. Returns null for anything unreadable. */
export function decodeInstalled(body: string): ChartPackInstalled | null {
  try {
    const o = parse(body, 'installed');
    const ms = o.installedAtMs;
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
    return {
      product: reqString(o, 'product'),
      edition: reqString(o, 'edition'),
      editionLabel: reqString(o, 'editionLabel'),
      installedAtMs: ms,
      files: reqArray(o, 'files').map((f) => {
        const file = asObject(f, 'files[]');
        return { name: reqString(file, 'name'), bytes: reqInt(file, 'bytes'), sha256: reqString(file, 'sha256') };
      }),
    };
  } catch {
    return null;
  }
}
