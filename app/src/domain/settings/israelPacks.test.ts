// Port of ViewModelTests/IsraelDiagramSettingsSummaryTests (1 case) plus characterisation of the wording and button
// rules in Views/Settings/IsraelChartDownloadSection.swift and IsraelDiagramDownloadSection.swift (no Swift tests there).
import {
  israelChartActions,
  israelChartDetailLine,
  israelChartDownloadLabel,
  israelDiagramButtonTitle,
  israelDiagramShowsDownload,
  israelDiagramSettingsSummary,
  israelDiagramSummaryFor,
  progressPercent,
  type IsraelChartPackState,
  type IsraelDiagramPackState,
  type IsraelDiagramSummaryInput,
} from './israelPacks';

const size = (bytes: number): string => `${bytes} B`;

const chart = (over: Partial<IsraelChartPackState> = {}): IsraelChartPackState => ({
  status: { kind: 'notDownloaded' },
  latestLabel: null,
  offeredBytes: null,
  installedBytes: null,
  isChecking: false,
  checkFailed: false,
  downloadProgress: null,
  pausedProgress: null,
  errorMessage: null,
  ...over,
});

const diagrams = (over: Partial<IsraelDiagramPackState> = {}): IsraelDiagramPackState => ({
  pack: null,
  latestLabel: null,
  isChecking: false,
  downloadProgress: null,
  errorMessage: null,
  canDownload: false,
  ...over,
});

/** The four inputs of Swift `IsraelDiagramSettingsSummary.init(pack:latest:isChecking:checkFailed:)`. */
const summary = (over: Partial<IsraelDiagramSummaryInput> = {}): IsraelDiagramSummaryInput => ({
  pack: null,
  latestLabel: null,
  isChecking: false,
  checkFailed: false,
  ...over,
});

describe('IsraelDiagramSettingsSummary', () => {
  it('notDownloadedWithoutAServerAnswerNeverImpliesAnEdition', () => {
    const offline = israelDiagramSettingsSummary(summary({ checkFailed: true }));
    expect(offline.detail).toContain('Not downloaded');
    expect(offline.detail).toContain("Can't reach");
    expect(offline.placed).toBeNull();

    const checking = israelDiagramSettingsSummary(summary({ isChecking: true }));
    expect(checking.detail).toContain('Checking');
  });

  it('an edition on the server reads as available, never as installed', () => {
    const s = israelDiagramSettingsSummary(summary({ latestLabel: '2026-01' }));
    expect(s.detail).toBe('Not downloaded. Edition 2026-01 is available.');
    expect(s.placed).toBeNull();
  });

  it('nothing published and no failure reads as no edition yet', () => {
    expect(israelDiagramSettingsSummary(summary()).detail).toBe('Not downloaded. No edition is published yet.');
  });

  it('the screen reads checkFailed as no edition on the server plus an error (IsraelDiagramDownloadSection.summary)', () => {
    expect(israelDiagramSummaryFor(diagrams({ errorMessage: 'offline' })).detail).toContain("Can't reach");
    expect(israelDiagramSummaryFor(diagrams({ latestLabel: 'E1', errorMessage: 'offline' })).detail).toBe(
      'Not downloaded. Edition E1 is available.',
    );
    expect(israelDiagramSummaryFor(diagrams({ isChecking: true })).detail).toContain('Checking');
    expect(israelDiagramSummaryFor(diagrams()).detail).toBe('Not downloaded. No edition is published yet.');
  });

  it('a server answer wins over checking and over a failure flag', () => {
    expect(
      israelDiagramSettingsSummary(summary({ latestLabel: 'E1', isChecking: true, checkFailed: true })).detail,
    ).toBe('Not downloaded. Edition E1 is available.');
  });

  it('an installed pack shows its edition, accuracy and placed aerodromes', () => {
    const s = israelDiagramSettingsSummary(
      summary({ pack: { editionLabel: 'Edition 5', accuracyFeet: 150, georeferencedICAOs: ['LLBG', 'LLHZ'] } }),
    );
    expect(s.detail).toBe('Installed: Edition 5. Placed on the map to about \u00B1150 ft.');
    expect(s.placed).toBe('Placed on the map: LLBG, LLHZ');
  });

  it('an installed pack with no georeferenced aerodrome says so', () => {
    const s = israelDiagramSettingsSummary(
      summary({ pack: { editionLabel: 'Edition 5', accuracyFeet: 150, georeferencedICAOs: [] } }),
    );
    expect(s.placed).toBe('No aerodrome is placed on the map in this edition.');
  });

  it('an installed pack ignores the check flags', () => {
    const s = israelDiagramSettingsSummary(
      summary({
        pack: { editionLabel: 'Edition 5', accuracyFeet: 150, georeferencedICAOs: ['LLBG'] },
        isChecking: true,
        checkFailed: true,
      }),
    );
    expect(s.detail.startsWith('Installed: Edition 5')).toBe(true);
  });
});

describe('diagram button', () => {
  const pack = { editionLabel: 'E', accuracyFeet: 1, georeferencedICAOs: [] };
  it.each([
    [diagrams({ canDownload: true }), 'Download'],
    [diagrams({ canDownload: true, pack }), 'Update'],
    [diagrams({ canDownload: true, errorMessage: 'boom' }), 'Retry'],
    [diagrams({ canDownload: true, pack, errorMessage: 'boom' }), 'Retry'],
  ])('title for %j', (state, title) => {
    expect(israelDiagramButtonTitle(state)).toBe(title);
  });
});

describe('diagram button visibility', () => {
  it('shows only when nothing is downloading and an edition is on offer', () => {
    expect(israelDiagramShowsDownload(diagrams({ canDownload: true }))).toBe(true);
    expect(israelDiagramShowsDownload(diagrams({ canDownload: true, downloadProgress: 0.2 }))).toBe(false);
    expect(israelDiagramShowsDownload(diagrams({ canDownload: false }))).toBe(false);
  });
});

describe('chart row wording', () => {
  it('not downloaded with an edition offered shows its label and size', () => {
    const s = chart({ latestLabel: '2026-01', offeredBytes: 1500 });
    expect(israelChartDetailLine(s, size)).toBe('Edition 2026-01, 1500 B');
  });

  it('not downloaded, still checking', () => {
    expect(israelChartDetailLine(chart({ isChecking: true }), size)).toBe('Checking for the latest edition\u2026');
  });

  it('not downloaded, server unreachable', () => {
    expect(israelChartDetailLine(chart({ checkFailed: true }), size)).toBe(
      "Can't reach the chart server. Connect to the internet to download.",
    );
  });

  it('not downloaded, nothing published', () => {
    expect(israelChartDetailLine(chart(), size)).toBe('No official chart is published yet.');
  });

  it('installed shows the edition and installed size', () => {
    const s = chart({ status: { kind: 'installed', label: '2025-02' }, installedBytes: 900 });
    expect(israelChartDetailLine(s, size)).toBe('Installed: edition 2025-02, 900 B. Checksum verified.');
  });

  it('update available still describes the installed edition', () => {
    const s = chart({
      status: { kind: 'updateAvailable', label: '2025-02', latestLabel: '2026-01' },
      installedBytes: 900,
      latestLabel: '2026-01',
      offeredBytes: 1500,
    });
    expect(israelChartDetailLine(s, size)).toBe('Installed: edition 2025-02, 900 B. Checksum verified.');
  });
});

describe('chart download label', () => {
  const installed = { kind: 'installed', label: 'E' } as const;
  const update = { kind: 'updateAvailable', label: 'E', latestLabel: 'E2' } as const;
  it.each([
    ['not downloaded', chart(), 'Download'],
    ['not downloaded, paused', chart({ pausedProgress: 0.4 }), 'Resume'],
    ['not downloaded, failed', chart({ errorMessage: 'x' }), 'Retry'],
    ['not downloaded, paused and failed', chart({ pausedProgress: 0.4, errorMessage: 'x' }), 'Retry'],
    ['update available', chart({ status: update }), 'Update'],
    ['update available, failed', chart({ status: update, errorMessage: 'x' }), 'Retry'],
    ['installed', chart({ status: installed }), null],
    ['installed, failed', chart({ status: installed, errorMessage: 'x' }), null],
  ])('%s -> %s', (_name, state, label) => {
    expect(israelChartDownloadLabel(state)).toBe(label);
  });
});

describe('chart row actions', () => {
  const installed = { kind: 'installed', label: 'E' } as const;
  it('downloading offers Pause only (no delete, no download)', () => {
    expect(israelChartActions(chart({ downloadProgress: 0.5, status: installed, latestLabel: 'E' }))).toEqual({
      pause: true,
      download: null,
      remove: false,
    });
  });

  it('download needs an edition on the server', () => {
    expect(israelChartActions(chart()).download).toBeNull();
    expect(israelChartActions(chart({ latestLabel: 'E1', offeredBytes: 1 })).download).toBe('Download');
  });

  it('installed and current offers Delete only', () => {
    expect(israelChartActions(chart({ status: installed, latestLabel: 'E' }))).toEqual({
      pause: false,
      download: null,
      remove: true,
    });
  });

  it('update available offers Update and Delete', () => {
    const state = chart({ status: { kind: 'updateAvailable', label: 'E', latestLabel: 'E2' }, latestLabel: 'E2' });
    expect(israelChartActions(state)).toEqual({ pause: false, download: 'Update', remove: true });
  });
});

describe('progressPercent (Int(progress * 100))', () => {
  it.each([
    [0, 0],
    [0.5, 50],
    [0.999, 99], // truncates, never rounds up to 100
    [1, 100],
    [0.075, 7],
    [Number.NaN, 0], // JS-only guards: Swift Int(NaN) would trap
    [-0.2, 0],
    [1.4, 100],
  ])('%s -> %s', (fraction, percent) => {
    expect(progressPercent(fraction)).toBe(percent);
  });
});
