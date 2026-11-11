// Map render status for CI: lifecycle events and MapLibre native warnings are logged as "SPIKE_MAP {...}" and written to
// map-status.json so the capture scripts can wait for a fully rendered map before a screenshot (scripts/*-capture.sh).
import { LogManager } from '@maplibre/maplibre-react-native';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { MAP_STATUS_FILE, writeResult } from '../../adapters/resultFile';

export type MapStatus = {
  platform: string;
  night: boolean;
  events: Record<string, number>;
  fullyRendered: boolean;
  failed: boolean;
  native: string[];
  /** queryRenderedFeatures count per layer: a symbol layer at 0 was not placed (image / glyph problem); a count > 0
   *  with nothing on screen means placed but not drawn (renderer / GPU problem). */
  rendered?: Record<string, number | string>;
  missingImages: string[];
};

/** Layers whose placement CI probes once the map is fully rendered. */
export const PROBED_LAYERS = ['ownship-symbol', 'track-ruler-ticks', 'track-ruler-line', 'airport-circles', 'street-place-label'];

/** Records the first occurrence of a lifecycle event (ms since mount), then logs and persists the cumulative status. */
export function report(status: MapStatus, t0: number, event: string) {
  if (event in status.events) return; // render events repeat on every change; the first one is what CI waits for
  status.events[event] = Math.round(performance.now() - t0);
  if (event === 'didFailLoadingMap') status.failed = true;
  console.log('SPIKE_MAP ' + JSON.stringify(status));
  writeResult(MAP_STATUS_FILE, status).catch((e) => console.warn('map status write failed', e));
}

let current: MapStatus | null = null;
/** The status of the mounted surface (the animation harness embeds it in its result file). */
export const getCurrentMapStatus = (): MapStatus | null => current;

/** Owns the mutable status of one mounted surface (a class so React state never holds a mutated plain object). */
export class MapStatusReporter {
  readonly status: MapStatus;
  private readonly t0 = performance.now();

  constructor(night: boolean) {
    this.status = {
      platform: Platform.OS,
      night,
      events: {},
      fullyRendered: false,
      failed: false,
      native: [],
      missingImages: [],
    };
  }

  report(event: string): void {
    report(this.status, this.t0, event);
  }

  setNight(night: boolean): void {
    this.status.night = night;
  }

  addNative(entry: string): void {
    // Capped so the SPIKE_MAP logcat line stays under Android's ~4 KB limit.
    if (this.status.native.length < 12) this.status.native.push(entry.slice(0, 200));
  }

  addMissingImage(name: string): void {
    this.status.missingImages.push(name);
  }

  markRendered(rendered: Record<string, number | string>): void {
    this.status.rendered = rendered;
    this.status.fullyRendered = true;
    this.report('symbolsProbed');
  }

  has(event: string): boolean {
    return event in this.status.events;
  }
}

/** One reporter per mounted surface, plus the native-log capture and the 40 s "never fully rendered" snapshot. */
export function useMapStatus(night: boolean): MapStatusReporter {
  const [reporter] = useState(() => new MapStatusReporter(night));

  useEffect(() => {
    reporter.setNight(night);
    current = reporter.status;
  }, [reporter, night]);

  useEffect(() => {
    LogManager.onLog(({ level, tag, message }) => {
      reporter.addNative(`${level} ${tag} ${message}`);
      return false; // keep MapLibre's own console output
    });
    LogManager.start();
    const snapshot = setTimeout(() => reporter.report('snapshot40s'), 40_000);
    return () => {
      clearTimeout(snapshot);
      LogManager.stop();
    };
  }, [reporter]);

  return reporter;
}
