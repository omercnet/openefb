// The official CAAI chart pack on the live map: whether one is installed and where its MBTiles file is (IsraelChartStore
// packPath), followed as the pilot downloads, updates or removes it in Settings. Israel only.
import { useSyncExternalStore } from 'react';
import { israelOfficialChartUrl } from '../../domain/map/israel/layers';

/** The part of IsraelChartStore the map reads. */
export interface OfficialChartSource {
  readonly packPath: string | null;
  subscribe(listener: () => void): () => void;
  getVersion(): number;
}

export interface OfficialChart {
  present: boolean;
  /** `mbtiles://` URL of the installed pack, null without one. */
  url: string | null;
}

const NONE: OfficialChart = { present: false, url: null };

export function officialChartOf(source: Pick<OfficialChartSource, 'packPath'> | null): OfficialChart {
  // An Expo file URI (`file:///data/x`) names the same file as its path: mbtiles:// takes the absolute path only.
  const raw = source?.packPath ?? null;
  const path = raw?.startsWith('file://') ? decodeURI(raw.slice('file://'.length)) : raw;
  return path ? { present: true, url: israelOfficialChartUrl(path) } : NONE;
}

export function useOfficialChart(source: OfficialChartSource | null, enabled: boolean): OfficialChart {
  // Re-evaluated when the store says it changed; the snapshot is its version, the value is derived from it.
  useSyncExternalStore(
    (listener) => (source ? source.subscribe(listener) : () => undefined),
    () => (source ? source.getVersion() : 0),
  );
  return enabled ? officialChartOf(source) : NONE;
}
