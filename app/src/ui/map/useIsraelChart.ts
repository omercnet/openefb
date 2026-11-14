// The Israel chart sources for the live map (IsraelChartOverlay): loaded once from the Israel database, closures redrawn
// from the NOTAM feed at most every five minutes (IsraelChartOverlay.fetchInterval). Nothing happens outside Israel.
import { useEffect, useState } from 'react';
import type { FeatureCollection } from '../../domain/map/geojson';
import type { IsraelClosureStatus } from '../../domain/map/israel';
import type { IsraelChartInput } from '../../domain/map/israel/layers';
import type { IsraelNotamServiceLike } from '../../services/israelNotamService';
import { currentReport, israelChartSources, loadIsraelChart, type IsraelChartDb } from '../shell/israelFeed';

export const ISRAEL_CLOSURE_REFRESH_MS = 300_000;

export interface IsraelChartInputs {
  db: IsraelChartDb | null;
  notam: IsraelNotamServiceLike | null;
  /** True in the Israel region. */
  enabled: boolean;
  /** The layer panel status for the closures (IsraelChartOverlay.closureStatus). */
  onClosureStatus?: (status: IsraelClosureStatus) => void;
  now?: () => number;
}

/** The sources to pass to the map as `extraSources`; undefined until the chart data has loaded. */
export function useIsraelChart({
  db,
  notam,
  enabled,
  onClosureStatus,
  now = Date.now,
}: IsraelChartInputs): Readonly<Record<string, FeatureCollection>> | undefined {
  const [sources, setSources] = useState<Readonly<Record<string, FeatureCollection>>>();
  useEffect(() => {
    if (!enabled || !db) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let input: IsraelChartInput | null = null;
    const apply = async () => {
      if (!input) return;
      const report = await currentReport(notam);
      const built = await israelChartSources(input, report, now());
      if (cancelled) return;
      setSources(built.sources);
      onClosureStatus?.(built.status);
    };
    loadIsraelChart(db).then(
      (loaded) => {
        if (cancelled) return;
        input = loaded;
        void apply();
        timer = setInterval(() => void apply(), ISRAEL_CLOSURE_REFRESH_MS);
      },
      (error) => console.warn('Israel chart data failed to load', error),
    );
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [db, notam, enabled, onClosureStatus, now]);
  return enabled ? sources : undefined;
}
