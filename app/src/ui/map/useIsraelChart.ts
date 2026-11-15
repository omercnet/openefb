// The Israel chart sources for the live map (IsraelChartOverlay): loaded once from the Israel database, closures redrawn
// from the NOTAM feed at most every five minutes (IsraelChartOverlay.fetchInterval). Nothing happens outside Israel.
import { useCallback, useEffect, useState } from 'react';
import type { Coordinate } from '../../domain/core';
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
}: IsraelChartInputs): IsraelChart {
  const [sources, setSources] = useState<Readonly<Record<string, FeatureCollection>>>();
  const [points, setPoints] = useState<ReadonlyMap<string, Coordinate>>(NO_POINTS);
  useEffect(() => {
    if (!enabled || !db) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let input: IsraelChartInput | null = null;
    let running = false;
    const apply = async (first: boolean) => {
      if (!input || running) return;
      running = true;
      try {
        // The chart itself needs only the database: draw it before the relay answers (or times out after 15 s).
        if (first) {
          const base = await israelChartSources(input, null, now());
          if (cancelled) return;
          setSources(base.sources);
          // The base chart has no closures yet: the Layers row must not keep the previous status for data that is gone.
          onClosureStatus?.({ kind: 'noFeed' });
        }
        // A scheduled refresh bypasses the service's five-minute copy, which would otherwise be skipped as still fresh.
        const report = await currentReport(notam, !first);
        const built = await israelChartSources(input, report, now());
        if (cancelled) return;
        setSources(built.sources);
        onClosureStatus?.(built.status);
      } finally {
        running = false;
      }
    };
    loadIsraelChart(db).then(
      (loaded) => {
        if (cancelled) return;
        input = loaded;
        setPoints(pointIndex(loaded));
        void apply(true);
        timer = setInterval(() => void apply(false), ISRAEL_CLOSURE_REFRESH_MS);
      },
      (error) => console.warn('Israel chart data failed to load', error),
    );
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [db, notam, enabled, onClosureStatus, now]);
  const pointLookup = useCallback((code: string) => points.get(code.toUpperCase()) ?? null, [points]);
  return { sources: enabled ? sources : undefined, pointLookup };
}

export interface IsraelChart {
  sources: Readonly<Record<string, FeatureCollection>> | undefined;
  /** A reporting point or aerodrome by code (the briefing highlight's lookup); null when unknown or not loaded. */
  pointLookup: (code: string) => Coordinate | null;
}

const NO_POINTS: ReadonlyMap<string, Coordinate> = new Map();

/** Reporting points, then aerodromes, by upper-case code (IsraelBriefingMapHighlight.show's lookup order). */
export function pointIndex(input: IsraelChartInput): ReadonlyMap<string, Coordinate> {
  const index = new Map<string, Coordinate>();
  for (const a of input.aerodromes) index.set(a.code.toUpperCase(), { lat: a.latitude, lon: a.longitude });
  for (const p of input.points) index.set(p.code.toUpperCase(), { lat: p.latitude, lon: p.longitude });
  return index;
}
