// Port of IsraelAlertService (Services/IsraelAlertService.swift): Israel in-flight alerts (IL-ALERTS): closed legs on the
// active route, P/R/D areas and CTRs on the projected track, border buffers, the CVFR squawk reminder. The rules live in
// domain/israel/alertEvaluator.ts (L3); this class adds what needs state: the NOTAM feed, throttling, a hold time so an
// alert does not flicker at a boundary, and "newly raised" detection for the haptic.
// Israel only: outside the Israel region it shows nothing.
import { WHOLE_COUNTRY, type IsraelAerodrome, type IsraelAirspace } from '../data/aviation/israelTypes';
import type { IsraelAviationDatabase } from '../data/aviation/israelDatabase';
import type { Region } from '../domain/core/region';
import { evaluateFreshness } from '../domain/core/freshness';
import {
  GAZA_AREA_CODE,
  airspaceAlerts,
  borderAlerts,
  closureAlerts,
  initialSquawkReminder,
  shortAerodromeName,
  sortAlerts,
  squawkReminderAlert,
  towerContact,
  updateSquawkReminder,
  type CtrContact,
  type IsraelAlert,
  type IsraelBorderBuffers,
  type SquawkReminderState,
} from '../domain/israel/alertEvaluator';
import { IsraelNetworkLookup, DRAWABLE_FRESHNESS } from '../domain/israel/closureMarks';
import { mapClosures } from '../domain/israel/closureMapper';
import { closureIsValidAt, closureCovers, closureSeverity } from '../domain/israel/notamTypes';
import type { IsraelChartClosureMark } from '../domain/israel/l3bStandIns';
import type { ActiveRoute } from '../domain/route/activeRoute';
import type { IsraelNotamReport } from './israelNotam';
import { systemClock, type Clock, type Logger } from './ports';

/** Evaluate at most this often -- seconds. */
export const ISRAEL_ALERT_EVALUATION_INTERVAL_SECONDS = 5;
/** An alert that stops applying stays up this long (no flicker on a boundary) -- seconds. */
export const ISRAEL_ALERT_HOLD_SECONDS = 10;
/** Airspace lookup radius around the aircraft; covers the 2-minute projection at 180 kt (6 NM) -- nautical miles. */
export const ISRAEL_ALERT_LOOKUP_RADIUS_NM = 12;
/** Re-read the NOTAM feed this often (the relay caches 5 min) -- seconds. */
export const ISRAEL_CLOSURE_REFRESH_INTERVAL_SECONDS = 300;

export type ClosureMarks = ReadonlyMap<number, IsraelChartClosureMark>;
export type ClosureMarkBuilder = (
  report: IsraelNotamReport | null,
  network: IsraelNetworkLookup,
  nowMs: number,
) => Promise<ClosureMarks>;

/** STAND-IN for IsraelChartFeatureBuilder.closures(...).marks (Services/IsraelChartFeatures.swift, ticket M1, not ported
 * yet): CVFR closures valid now, mapped onto segments. A feed that is not fresh or old yields no marks. Text is the plain
 * "CLSD" / "CHECK NOTAM"; M1 supplies the real chart wording through `closureMarks`. */
export const defaultClosureMarks: ClosureMarkBuilder = async (report, network, nowMs) => {
  const marks = new Map<number, IsraelChartClosureMark>();
  if (!report) return marks;
  const level = evaluateFreshness('notam', { observed: report.feed.generatedAt, now: nowMs }).level;
  if (!DRAWABLE_FRESHNESS.includes(level)) return marks;
  const active = report.feed.closures.filter((c) => closureCovers(c, 'CVFR') && closureIsValidAt(c, nowMs));
  const mapping = await mapClosures(active, network);
  for (const match of mapping.matches) {
    const severity = closureSeverity(match.closure);
    for (const segment of match.segments) {
      if (marks.get(segment.id)?.severity === 'full') continue;
      marks.set(segment.id, {
        notamID: match.closure.notamId,
        text: severity === 'check' ? 'CHECK NOTAM' : 'CLSD',
        schedule: match.closure.schedule,
        severity,
        notes: [],
      });
    }
  }
  return marks;
};

export interface IsraelAlertServiceOptions {
  /** The aviation database (D5); opened lazily at the first evaluation in Israel. */
  databaseProvider: () => Promise<IsraelAviationDatabase>;
  /** The NOTAM feed; null/omitted = no feed (no closure alerts). */
  notamFetcher?: (() => Promise<IsraelNotamReport>) | null;
  borderBuffers?: IsraelBorderBuffers | null;
  closureMarks?: ClosureMarkBuilder;
  now?: Clock;
  log?: Logger;
}

export interface IsraelFix {
  region: Region;
  route: ActiveRoute | null;
  position: { lat: number; lon: number };
  altitudeFeet: number | null;
  trackTrue: number;
  groundSpeedKnots: number;
  /** epoch ms; defaults to the injected clock */
  nowMs?: number;
}

const sameAlerts = (a: readonly IsraelAlert[], b: readonly IsraelAlert[]): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export class IsraelAlertService {
  /** Alerts to show, highest priority first (red before amber). */
  alerts: IsraelAlert[] = [];
  /** Called once for every alert that was not showing a moment ago (the map plays one haptic). */
  onRaised: ((alerts: IsraelAlert[]) => void) | null = null;

  private database: IsraelAviationDatabase | null = null;
  private databaseLoad: Promise<void> | null = null;
  private network: IsraelNetworkLookup | null = null;
  private gazaRings: number[][][] | null = null;
  private closureMarks: ClosureMarks = new Map();
  private report: IsraelNotamReport | null = null;
  private lastEvaluation: number | null = null;
  private lastClosureFetch: number | null = null;
  private fetching = false;
  private held = new Map<string, { alert: IsraelAlert; lastSeen: number }>();
  private squawk: SquawkReminderState = initialSquawkReminder();
  /** Bumped by every fix, suspend and reset: an evaluation that is overtaken must not publish. */
  private epoch = 0;
  private marksSeq = 0;
  private readonly now: Clock;
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(private readonly options: IsraelAlertServiceOptions) {
    this.now = options.now ?? systemClock;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getVersion = (): number => this.version;

  private changed(): void {
    this.version += 1;
    for (const l of [...this.listeners]) {
      try {
        l();
      } catch (error) {
        this.options.log?.(`Israel alert listener failed: ${String(error)}`);
      }
    }
  }

  /** Evaluate for a fix. Throttled to the evaluation interval; cheap enough to call on every location update. */
  async update(fix: IsraelFix): Promise<void> {
    const nowMs = fix.nowMs ?? this.now();
    if (fix.region !== 'israel') {
      this.reset();
      return;
    }
    // The squawk reminder watches every fix: a departure takes seconds.
    this.squawk = updateSquawkReminder(this.squawk, fix.groundSpeedKnots, nowMs).state;

    if (this.lastEvaluation !== null && (nowMs - this.lastEvaluation) / 1000 < ISRAEL_ALERT_EVALUATION_INTERVAL_SECONDS)
      return;
    this.lastEvaluation = nowMs;
    const epoch = ++this.epoch;

    await this.loadDatabaseIfNeeded();
    this.refreshClosuresIfNeeded(nowMs);

    const database = this.database;
    let current: IsraelAlert[] = this.guarded('closure alerts', () => closureAlerts(fix.route, this.closureMarks));
    if (database) {
      try {
        const nearby = await database.airspacesNear(fix.position, ISRAEL_ALERT_LOOKUP_RADIUS_NM);
        const contacts = await this.ctrContacts(database, nearby);
        current = current.concat(
          airspaceAlerts({
            position: fix.position,
            altitudeFeet: fix.altitudeFeet,
            trackTrue: fix.trackTrue,
            groundSpeedKnots: fix.groundSpeedKnots,
            airspaces: nearby,
            ctrContact: (code) => contacts.get(code) ?? null,
          }),
        );
      } catch (error) {
        this.options.log?.(`Israel airspace lookup failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (epoch !== this.epoch) return; // a newer fix, a suspend or a region change took over while the database answered
    current = current.concat(
      this.guarded('border alerts', () =>
        borderAlerts({
          position: fix.position,
          trackTrue: fix.trackTrue,
          groundSpeedKnots: fix.groundSpeedKnots,
          buffers: this.options.borderBuffers ?? null,
          gazaRings: this.gazaRings ?? [],
        }),
      ),
    );
    const reminder = this.guarded('squawk reminder', () => squawkReminderAlert(this.squawk, nowMs));
    if (reminder && !Array.isArray(reminder)) current.push(reminder);
    this.publish(current, nowMs);
  }

  /** One failing rule must not take the other alerts down with it: log and contribute nothing. */
  private guarded<T extends IsraelAlert[] | IsraelAlert | null>(what: string, rule: () => T): T | IsraelAlert[] {
    try {
      return rule();
    } catch (error) {
      this.options.log?.(`Israel ${what} failed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  /** Merge the fresh alerts with the held ones: an alert absent for less than the hold time stays up. */
  private publish(current: IsraelAlert[], nowMs: number): void {
    const before = new Set(this.alerts.map((a) => a.id));
    for (const alert of current) this.held.set(alert.id, { alert, lastSeen: nowMs });
    for (const [id, h] of [...this.held])
      if ((nowMs - h.lastSeen) / 1000 > ISRAEL_ALERT_HOLD_SECONDS) this.held.delete(id);
    const shown = sortAlerts([...this.held.values()].map((h) => h.alert));
    if (!sameAlerts(shown, this.alerts)) {
      this.alerts = shown;
      this.changed();
    }
    const raised = shown.filter((a) => !before.has(a.id));
    if (raised.length > 0) {
      try {
        this.onRaised?.(raised);
      } catch (error) {
        this.options.log?.(`Israel alert onRaised failed: ${String(error)}`);
      }
    }
  }

  /** No fresh fix: drop every shown and held alert (the last ones describe a place the aircraft may have left), and evaluate
   * again at the next fix. The squawk reminder keeps its state: it watches speed, not position. */
  suspend(): void {
    this.epoch += 1;
    // An evaluation that was in flight is dropped above; the next fix must not wait out its throttle either.
    this.lastEvaluation = null;
    if (this.alerts.length === 0 && this.held.size === 0) return;
    this.alerts = [];
    this.held = new Map();
    this.changed();
  }

  private reset(): void {
    this.epoch += 1;
    this.lastEvaluation = null;
    this.squawk = initialSquawkReminder();
    if (this.alerts.length === 0 && this.held.size === 0) return;
    this.alerts = [];
    this.held = new Map();
    this.changed();
  }

  // MARK: Data

  private loadDatabaseIfNeeded(): Promise<void> {
    if (this.database) return Promise.resolve();
    if (this.databaseLoad) return this.databaseLoad;
    const load: Promise<void> = (async () => {
      try {
        const db = await this.options.databaseProvider();
        const gaza = await db
          .airspacesOfKind('P')
          .then((areas) => ringsOf(areas))
          .catch(() => [] as number[][][]);
        this.network = new IsraelNetworkLookup(
          await db.reportingPoints(WHOLE_COUNTRY),
          await db.routeSegments(WHOLE_COUNTRY),
        );
        this.gazaRings = gaza;
        this.database = db;
      } catch (error) {
        this.options.log?.(
          `Israel aviation database unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    })().finally(() => {
      // Cleared only after `this.databaseLoad = load` below has run (a provider that throws synchronously settles the
      // promise before the assignment), and only by its own load: a failed open is retried at the next evaluation.
      if (this.databaseLoad === load) this.databaseLoad = null;
    });
    this.databaseLoad = load;
    return this.databaseLoad;
  }

  private async ctrContacts(
    db: IsraelAviationDatabase,
    areas: readonly IsraelAirspace[],
  ): Promise<Map<string, CtrContact>> {
    const out = new Map<string, CtrContact>();
    for (const area of areas) {
      if (area.kind !== 'CTR' || area.code === null || out.has(area.code)) continue;
      let aerodrome: IsraelAerodrome | null = null;
      try {
        aerodrome = await db.aerodrome(area.code);
      } catch {
        aerodrome = null;
      }
      if (aerodrome)
        out.set(area.code, { name: shortAerodromeName(aerodrome.nameEnglish), twr: towerContact(aerodrome) });
    }
    return out;
  }

  /** Fetch the NOTAM feed in the background; the marks are rebuilt at every evaluation so a feed that ages past the NOTAM
   * limit stops raising closures. Marks computed here show at the next evaluation. */
  private refreshClosuresIfNeeded(nowMs: number): void {
    const fetcher = this.options.notamFetcher;
    if (
      fetcher &&
      !this.fetching &&
      (this.lastClosureFetch === null ||
        (nowMs - this.lastClosureFetch) / 1000 >= ISRAEL_CLOSURE_REFRESH_INTERVAL_SECONDS)
    ) {
      this.lastClosureFetch = nowMs;
      this.fetching = true;
      void (async () => {
        try {
          this.report = await fetcher();
        } catch {
          // keep the previous report; Swift `try?`
        } finally {
          this.fetching = false;
        }
      })();
    }
    void this.rebuildMarks(nowMs);
  }

  private async rebuildMarks(nowMs: number): Promise<void> {
    const network = this.network;
    if (!network) return;
    const seq = ++this.marksSeq;
    try {
      const marks = await (this.options.closureMarks ?? defaultClosureMarks)(this.report, network, nowMs);
      if (seq === this.marksSeq) this.closureMarks = marks;
    } catch (error) {
      this.options.log?.(`Israel closure marks failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Test and preview hook: use `report` as the NOTAM feed now. */
  async setReport(report: IsraelNotamReport | null, nowMs: number = this.now()): Promise<void> {
    this.report = report;
    await this.rebuildMarks(nowMs);
  }
}

/** Outer rings of the CAAI LLP19 polygon as [lat, lon] vertices. */
function ringsOf(areas: readonly IsraelAirspace[]): number[][][] {
  return areas
    .filter((a) => a.code === GAZA_AREA_CODE)
    .flatMap((a) => a.polygons)
    .flatMap((p) => (p[0] ? [p[0]] : []))
    .map((ring) => ring.map((c) => [c.lat, c.lon]));
}
