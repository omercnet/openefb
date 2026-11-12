// Wording and button rules of Settings > Region (Israel): the official CAAI CVFR chart row (IsraelChartDownloadSection.swift)
// and the aerodrome diagram row (IsraelDiagramDownloadSection.swift). Pure, so the copy is testable without a view.
//
// The pack states are what S1's IsraelChartStore / IsraelDiagramStore expose to those views, as plain data. Property names
// follow the Swift stores so the S1 ports can satisfy them directly.

export type IsraelChartStatus =
  | { kind: 'notDownloaded' }
  | { kind: 'installed'; label: string }
  | { kind: 'updateAvailable'; label: string; latestLabel: string };

export interface IsraelChartPackState {
  status: IsraelChartStatus;
  /** `latest?.label`: the newest edition the server offers; null offline or when none is published. */
  latestLabel: string | null;
  /** `latest?.totalBytes ?? installed?.totalBytes` */
  offeredBytes: number | null;
  /** `installed?.totalBytes` */
  installedBytes: number | null;
  isChecking: boolean;
  checkFailed: boolean;
  /** Fraction 0...1 while downloading, null otherwise (`isDownloading` is `downloadProgress != nil`). */
  downloadProgress: number | null;
  pausedProgress: number | null;
  errorMessage: string | null;
}

export interface IsraelChartActions {
  pause: boolean;
  /** Title of the download button, null when there is nothing to fetch. */
  download: string | null;
  remove: boolean;
}

/** Int(progress * 100). JS-only guard: NaN reads 0 (Swift would trap) and the value is held to 0...100. */
export function progressPercent(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  return Math.min(100, Math.max(0, Math.trunc(fraction * 100)));
}

/** The row's second line. `formatBytes` is OfflineSizeFormatter.string (M3). */
export function israelChartDetailLine(s: IsraelChartPackState, formatBytes: (bytes: number) => string): string {
  if (s.status.kind === 'notDownloaded') {
    if (s.latestLabel !== null) {
      return `Edition ${s.latestLabel}, ${s.offeredBytes === null ? '' : formatBytes(s.offeredBytes)}`;
    }
    if (s.isChecking) return 'Checking for the latest edition\u2026';
    return s.checkFailed
      ? "Can't reach the chart server. Connect to the internet to download."
      : 'No official chart is published yet.';
  }
  const installedSize = s.installedBytes === null ? '' : formatBytes(s.installedBytes);
  return `Installed: edition ${s.status.label}, ${installedSize}. Checksum verified.`;
}

/** Null when there is nothing to fetch (already on the latest edition). */
export function israelChartDownloadLabel(s: IsraelChartPackState): string | null {
  const failed = s.errorMessage !== null;
  switch (s.status.kind) {
    case 'notDownloaded':
      return failed ? 'Retry' : s.pausedProgress === null ? 'Download' : 'Resume';
    case 'updateAvailable':
      return failed ? 'Retry' : 'Update';
    case 'installed':
      return null;
  }
}

export function israelChartActions(s: IsraelChartPackState): IsraelChartActions {
  const downloading = s.downloadProgress !== null;
  return {
    pause: downloading,
    download: !downloading && s.latestLabel !== null ? israelChartDownloadLabel(s) : null,
    remove: s.status.kind !== 'notDownloaded' && !downloading,
  };
}

export interface IsraelDiagramPack {
  editionLabel: string;
  /** `pack.index.accuracyFeet` */
  accuracyFeet: number;
  georeferencedICAOs: readonly string[];
}

export interface IsraelDiagramPackState {
  pack: IsraelDiagramPack | null;
  latestLabel: string | null;
  isChecking: boolean;
  downloadProgress: number | null;
  errorMessage: string | null;
  canDownload: boolean;
}

/** The four inputs of Swift `IsraelDiagramSettingsSummary.init`. */
export interface IsraelDiagramSummaryInput {
  pack: IsraelDiagramPack | null;
  latestLabel: string | null;
  isChecking: boolean;
  checkFailed: boolean;
}

export interface IsraelDiagramSummary {
  detail: string;
  placed: string | null;
}

/** What the diagram row says. */
export function israelDiagramSettingsSummary(input: IsraelDiagramSummaryInput): IsraelDiagramSummary {
  const { pack, latestLabel, isChecking, checkFailed } = input;
  if (pack !== null) {
    const ids = pack.georeferencedICAOs;
    return {
      detail: `Installed: ${pack.editionLabel}. Placed on the map to about \u00B1${pack.accuracyFeet} ft.`,
      placed:
        ids.length === 0
          ? 'No aerodrome is placed on the map in this edition.'
          : `Placed on the map: ${ids.join(', ')}`,
    };
  }
  if (latestLabel !== null) return { detail: `Not downloaded. Edition ${latestLabel} is available.`, placed: null };
  if (isChecking) return { detail: 'Checking for the latest edition\u2026', placed: null };
  if (checkFailed) return { detail: "Not downloaded. Can't reach the chart server.", placed: null };
  return { detail: 'Not downloaded. No edition is published yet.', placed: null };
}

/** The view passes `checkFailed: store.latest == nil && store.errorMessage != nil`. */
export const israelDiagramSummaryFor = (s: IsraelDiagramPackState): IsraelDiagramSummary =>
  israelDiagramSettingsSummary({
    pack: s.pack,
    latestLabel: s.latestLabel,
    isChecking: s.isChecking,
    checkFailed: s.latestLabel === null && s.errorMessage !== null,
  });

export const israelDiagramButtonTitle = (s: IsraelDiagramPackState): string =>
  s.errorMessage !== null ? 'Retry' : s.pack === null ? 'Download' : 'Update';

/** The button shows when nothing is downloading and an edition is on offer. */
export const israelDiagramShowsDownload = (s: IsraelDiagramPackState): boolean =>
  s.downloadProgress === null && s.canDownload;
