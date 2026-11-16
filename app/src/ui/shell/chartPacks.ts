// The chart packs on the real device (Swift: IsraelChartStore, IsraelDiagramStore and the US airport diagram overlay): the
// official CAAI CVFR chart, the CAAI aerodrome diagrams (`il-diagrams`) and the FAA airport diagrams (`us-diagrams`, fetched
// per airport and cached, or taken from an installed full pack). One service and one store per product, over the
// documents folder; Settings drives the stores and the diagram overlay reads the sources.
import type { AviationDatabase } from '../../data/aviation';
import type { IsraelAviationDatabase } from '../../data/aviation/israelDatabase';
import type { DiagramPackSource } from '../../domain/diagram/overlayController';
import type { IsraelChartStoreLike, IsraelDiagramStoreLike } from '../../domain/settings/packStores';
import type { IsraelChartPackState, IsraelDiagramPackState } from '../../domain/settings/israelPacks';
import { createDiagramSource } from '../../adapters/diagramSource';
import { createIsraelDiagramSource } from '../../adapters/israelDiagramSource';
import { createOnDemandUsDiagramSource } from '../../adapters/usDiagramOnDemand';
import { ChartPackService, DEFAULT_CHART_BASE_URL, ISRAEL_CVFR_PRODUCT } from '../../services/charts/chartPackService';
import { IsraelChartStore, IsraelDiagramStore } from '../../services/charts/chartStores';
import { DIAGRAM_PRODUCT, US_DIAGRAM_PRODUCT } from '../../services/charts/diagramPack';
import { installedTotalBytes, manifestLabel } from '../../services/charts/manifest';
import type { ChartFileSystem, FileDownloader } from '../../services/charts/ports';
import type { FetchLike, Logger, TextStorage } from '../../services/ports';

/** The part of the services' stores the Settings rows observe. */
interface Observed {
  subscribe(listener: () => void): () => void;
  getVersion(): number;
}

/** A snapshot that is the same object until the store changes (React reads it through useSyncExternalStore). */
function memoized<S>(store: Observed, read: () => S): () => S {
  let cached: { version: number; value: S } | null = null;
  return () => {
    const version = store.getVersion();
    if (!cached || cached.version !== version) cached = { version, value: read() };
    return cached.value;
  };
}

export function israelChartStoreLike(store: IsraelChartStore): IsraelChartStoreLike {
  const snapshot = memoized<IsraelChartPackState>(store, () => {
    const status = store.status;
    return {
      status:
        status.kind === 'notDownloaded'
          ? { kind: 'notDownloaded' }
          : status.kind === 'installed'
            ? { kind: 'installed', label: status.label }
            : { kind: 'updateAvailable', label: status.installedLabel, latestLabel: status.latestLabel },
      latestLabel: store.latest ? manifestLabel(store.latest) : null,
      offeredBytes: store.offeredBytes,
      installedBytes: store.installed ? installedTotalBytes(store.installed) : null,
      isChecking: store.isChecking,
      checkFailed: store.checkFailed,
      downloadProgress: store.downloadProgress,
      pausedProgress: store.pausedProgress,
      errorMessage: store.errorMessage,
    };
  });
  return {
    getSnapshot: snapshot,
    subscribe: store.subscribe,
    refresh: () => store.refresh(),
    startDownload: () => store.startDownload(),
    pauseDownload: () => void store.pauseDownload(),
    remove: () => void store.remove(),
  };
}

export function israelDiagramStoreLike(store: IsraelDiagramStore): IsraelDiagramStoreLike {
  const snapshot = memoized<IsraelDiagramPackState>(store, () => ({
    pack: store.pack
      ? {
          editionLabel: store.pack.editionLabel,
          accuracyFeet: store.pack.index.accuracyFeet,
          georeferencedICAOs: store.pack.georeferencedICAOs,
        }
      : null,
    latestLabel: store.latest ? manifestLabel(store.latest) : null,
    isChecking: store.isChecking,
    downloadProgress: store.downloadProgress,
    errorMessage: store.errorMessage,
    canDownload: store.canDownload,
  }));
  return {
    getSnapshot: snapshot,
    subscribe: store.subscribe,
    refresh: () => store.refresh(),
    startDownload: () => store.startDownload(),
  };
}

export interface ChartPacksDeps {
  fetch: FetchLike;
  fs: ChartFileSystem;
  downloader: FileDownloader;
  storage: TextStorage;
  /** Storage root of the packs: <root>/<product>. */
  root: string;
  aviation: AviationDatabase | null;
  israel: IsraelAviationDatabase | null;
  baseUrl?: string;
  /** Developer setting; false in release builds. */
  allowUnpublished?: () => boolean;
  log?: Logger;
}

export interface ChartPacks {
  israelChart: IsraelChartStore;
  israelDiagrams: IsraelDiagramStore;
  usDiagrams: IsraelDiagramStore;
  /** The overlay's pack source, routed by region. */
  diagramSource: DiagramPackSource;
}

export async function openChartPacks(deps: ChartPacksDeps): Promise<ChartPacks> {
  const service = (product: string) =>
    new ChartPackService({
      product,
      baseUrl: deps.baseUrl ?? DEFAULT_CHART_BASE_URL,
      root: deps.root,
      fs: deps.fs,
      fetch: deps.fetch,
      downloader: deps.downloader,
      log: deps.log,
    });
  const common = { allowUnpublished: deps.allowUnpublished, log: deps.log };
  const [israelChart, israelDiagrams, usDiagrams] = await Promise.all([
    IsraelChartStore.open({ service: service(ISRAEL_CVFR_PRODUCT), ...common }),
    IsraelDiagramStore.open({ service: service(DIAGRAM_PRODUCT), fs: deps.fs, storage: deps.storage, ...common }),
    IsraelDiagramStore.open({
      service: service(US_DIAGRAM_PRODUCT),
      fs: deps.fs,
      storage: deps.storage,
      ...common,
    }),
  ]);
  const usService = service(US_DIAGRAM_PRODUCT);
  const diagramSource = createDiagramSource({
    israel: createIsraelDiagramSource({
      loadPack: async () => israelDiagrams.pack,
      fs: deps.fs,
      // Without the Israel database there is nothing to place a diagram against: every lookup is "unavailable".
      israel: deps.israel ?? { aerodrome: async () => null },
      log: deps.log,
    }),
    us: createOnDemandUsDiagramSource({
      service: usService,
      fs: deps.fs,
      cacheDir: deps.fs.join(deps.root, 'us-diagrams-cache'),
      loadPack: async () => usDiagrams.pack,
      aviation: deps.aviation ?? { airportsNear: async () => [] },
      allowUnpublished: deps.allowUnpublished,
      log: deps.log,
    }),
  });
  return { israelChart, israelDiagrams, usDiagrams, diagramSource };
}
