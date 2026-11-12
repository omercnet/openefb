// Port of IsraelDiagramPack.swift: the official CAAI aerodrome diagrams we convert, validate and host ourselves (IL-13,
// product `il-diagrams`; tools/caai-apd builds it). Per aerodrome the pack carries the sheet PDF and, when the diagram
// passed the runway gate (100 ft), a PNG plus the georeference JSON (see diagramGeoreference.ts: computed offline, owner
// decision Q6). `index.json` says which aerodromes are georeferenced. A diagram that failed the gate is "sheet only":
// shown in the PDF viewer, never on the map. The diagrams are (c) CAAI.
//
// THE INTERFACE THE MAP TRACK (M4) CONSUMES: `loadDiagramPack` -> `IsraelDiagramPack.availability(icao)` /
// `diagramFiles(icao)` -> `loadGeoreference(pack, fs, icao)` (image path + decoded transform + `clipCorners`).
// Download and install go through ChartPackService (a second product, not a second downloader).
import { asObject, DecodeError, optString, reqBool, reqInt, reqString, type JsonObject } from '../jsonDecode';
import type { Logger } from '../ports';
import type { ChartPackServiceLike } from './chartPackService';
import { decodeGeoreference, type AirportDiagramGeoreference } from './diagramGeoreference';
import type { ChartFileSystem } from './ports';

export const DIAGRAM_PRODUCT = 'il-diagrams';
export const DIAGRAM_INDEX_FILE = 'index.json';

/** `index.json` of an edition: one record per aerodrome that has a chart. */
export interface DiagramIndexRecord {
  chart: string; // as printed, e.g. "AD 2 LLBG ADC-1"
  language: string;
  scale: string; // printed scale, or "bar only"
  georeferenced: boolean;
  reason: string; // "accepted", or why the gate rejected it
  sheet: string; // file name of the sheet PDF
  image: string | null; // file name of the transparent PNG (georeferenced only)
  georeference: string | null; // file name of the georeference JSON (georeferenced only)
}

export interface DiagramIndex {
  product: string;
  edition: string; // file-safe id, e.g. "2026-08"
  editionLabel: string; // as printed, e.g. "AIRAC AMDT 001/2026 (06 AUG 2026)"
  aipDate: string; // yyyy-MM-dd effective date of the source charts
  accuracyFeet: number; // feet: the gate placed diagrams passed
  aerodromes: Readonly<Record<string, DiagramIndexRecord>>; // ICAO -> record
}

/** What the app can show for one aerodrome. */
export type DiagramAvailability =
  /** Validated and drawable on the map. */
  | { kind: 'georeferenced'; record: DiagramIndexRecord }
  /** Chart exists but is shown only as a PDF sheet. */
  | { kind: 'sheetOnly'; record: DiagramIndexRecord }
  /** No chart for this aerodrome in the installed edition. */
  | { kind: 'none' };

/** Absolute paths of the files M4 draws from. */
export interface DiagramFiles {
  imagePath: string;
  georeferencePath: string;
  sheetPath: string | null;
}

export function decodeDiagramIndex(body: string): DiagramIndex {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new DecodeError('index is not JSON');
  }
  const o = asObject(json, 'index');
  const aerodromes = asObject(o.aerodromes, 'aerodromes');
  const records: Record<string, DiagramIndexRecord> = Object.create(null) as Record<string, DiagramIndexRecord>;
  for (const [icao, value] of Object.entries(aerodromes)) {
    const r: JsonObject = asObject(value, `aerodromes.${icao}`);
    records[icao] = {
      chart: reqString(r, 'chart'),
      language: reqString(r, 'language'),
      scale: reqString(r, 'scale'),
      georeferenced: reqBool(r, 'georeferenced'),
      reason: reqString(r, 'reason'),
      sheet: reqString(r, 'sheet'),
      image: optString(r, 'image'),
      georeference: optString(r, 'georeference'),
    };
  }
  return {
    product: reqString(o, 'product'),
    edition: reqString(o, 'edition'),
    editionLabel: reqString(o, 'editionLabel'),
    aipDate: reqString(o, 'aipDate'),
    accuracyFeet: reqInt(o, 'accuracyFeet'),
    aerodromes: records,
  };
}

export class IsraelDiagramPack {
  /** @param fileLocation absolute path of an installed file by name; null when it is missing. */
  constructor(
    readonly index: DiagramIndex,
    private readonly fileLocation: (name: string) => string | null,
  ) {}

  get edition(): string {
    return this.index.edition;
  }
  get editionLabel(): string {
    return this.index.editionLabel;
  }

  private record(icao: string): DiagramIndexRecord | undefined {
    const key = icao.toUpperCase();
    return Object.prototype.hasOwnProperty.call(this.index.aerodromes, key) ? this.index.aerodromes[key] : undefined;
  }

  availability(icao: string): DiagramAvailability {
    const record = this.record(icao);
    if (!record) return { kind: 'none' };
    if (
      record.georeferenced &&
      record.image !== null &&
      record.georeference !== null &&
      this.fileLocation(record.image) !== null &&
      this.fileLocation(record.georeference) !== null
    ) {
      return { kind: 'georeferenced', record };
    }
    // A georeferenced record with a missing file degrades to the sheet, never to a guess.
    return this.fileLocation(record.sheet) !== null ? { kind: 'sheetOnly', record } : { kind: 'none' };
  }

  /** ICAO ids that can be drawn on the map, sorted. */
  get georeferencedICAOs(): string[] {
    return Object.keys(this.index.aerodromes)
      .sort()
      .filter((icao) => this.availability(icao).kind === 'georeferenced');
  }

  sheetPath(icao: string): string | null {
    const record = this.record(icao);
    return record ? this.fileLocation(record.sheet) : null;
  }

  /** The image and georeference files of a drawable aerodrome; null when it is sheet only or absent. */
  diagramFiles(icao: string): DiagramFiles | null {
    const a = this.availability(icao);
    if (a.kind !== 'georeferenced' || a.record.image === null || a.record.georeference === null) return null;
    const imagePath = this.fileLocation(a.record.image);
    const georeferencePath = this.fileLocation(a.record.georeference);
    if (!imagePath || !georeferencePath) return null;
    return { imagePath, georeferencePath, sheetPath: this.fileLocation(a.record.sheet) };
  }

  /** Badge copy: edition and date of the chart on screen. Never implies currency the app cannot prove. */
  get badgeText(): string {
    return `CAAI aerodrome diagrams ${this.index.editionLabel} \u00b1${this.index.accuracyFeet} ft`;
  }
}

export interface LoadDiagramPackOptions {
  service: ChartPackServiceLike;
  fs: ChartFileSystem;
  /** The edition that was published and validated when it was downloaded (recorded by the store). */
  servedEdition: string | null;
  allowUnpublished: boolean;
}

/** The installed pack, or null. Pilots only see an edition that was published and validated when it was downloaded
 * (`servedEdition`); a debug setting can lift that. The index must belong to the installed edition. */
export async function loadDiagramPack(options: LoadDiagramPackOptions): Promise<IsraelDiagramPack | null> {
  const { service, fs, servedEdition, allowUnpublished } = options;
  try {
    const installed = await service.installed();
    if (!installed || installed.product !== DIAGRAM_PRODUCT) return null;
    if (!allowUnpublished && servedEdition !== installed.edition) return null;
    const indexPath = service.fileLocation(installed, DIAGRAM_INDEX_FILE);
    if (!indexPath) return null;
    const text = await fs.readText(indexPath);
    if (text === null) return null;
    const index = decodeDiagramIndex(text);
    if (index.product !== DIAGRAM_PRODUCT || index.edition !== installed.edition) return null;
    return new IsraelDiagramPack(index, (name) => service.fileLocation(installed, name));
  } catch {
    return null;
  }
}

/** The decoded georeference of a drawable aerodrome, with its image path, or null when the aerodrome is not drawable or
 * its georeference file is unreadable or invalid (a wrong overlay is worse than none: the caller draws nothing). */
export async function loadGeoreference(
  pack: IsraelDiagramPack,
  fs: ChartFileSystem,
  icao: string,
  log?: Logger,
): Promise<{ georeference: AirportDiagramGeoreference; imagePath: string } | null> {
  const files = pack.diagramFiles(icao);
  if (!files) return null;
  try {
    const text = await fs.readText(files.georeferencePath);
    if (text === null) return null;
    return { georeference: decodeGeoreference(text), imagePath: files.imagePath };
  } catch (error) {
    log?.(`Unreadable georeference for ${icao}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
