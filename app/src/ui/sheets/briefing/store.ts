// The briefing slice and IsraelBriefingViewModel (ViewModels/IsraelBriefingViewModel.swift): loads the relay feed,
// applies the flight-window, distance and aerodrome filters, and tracks read/unread. A feed past the NOTAM freshness limit
// is never listed as current. The slice holds the plain state; the view model writes it and derives the rows through
// logic.ts. I1 passes the real IsraelNotamService and NotamReadStateStore in; until then the capture fixture feeds it.
import type { StoreApi } from 'zustand';
import type { DataFreshness } from '../../../domain/core/freshness';
import { errorDescription } from '../../../domain/core/errorInfo';
import { AppFailure } from '../../../domain/errors';
import type {
  BriefingQuery,
  BriefingRoute,
  BriefingRow,
  BriefingSection,
  BriefingWindow,
} from '../../../domain/israel/briefingFilter';
import type { IsraelLatLon, IsraelNotam } from '../../../domain/israel/notamTypes';
import type { IsraelNotamReport } from '../../../services/israelNotam';
import { createStoreContext } from '../../state/storeContext';
import { captureBriefingData } from './fixture';
import {
  briefingFreshness,
  briefingQuery,
  briefingWindow,
  isCurrent,
  isListable,
  rowsInSection,
  unreadCount,
  visibleRows,
  type BriefingInputs,
  type DistanceChoice,
  type HighlightTint,
  type WindowChoice,
} from './logic';

export interface BriefingData extends BriefingInputs {
  isLoading: boolean;
  errorMessage: string | null;
  /** Bumped on every read-state change, so views over the slice re-render their unread dots and counts. */
  readVersion: number;
}

/** FAKE: the capture fixture (an expired 117-NOTAM feed on the Herzliya to Rosh Pina route) until I1 loads the relay. */
export const briefing = createStoreContext<BriefingData>(captureBriefingData());

/** Downloads the feed; `force` bypasses the service's five-minute cache (pull to refresh, Retry). */
export type BriefingFetcher = (force: boolean) => Promise<IsraelNotamReport>;

/** What the read state is keyed by: the id and the created stamp (NotamReadStateStore.readKey). */
type NotamKey = Pick<IsraelNotam, 'id' | 'created'>;

/**
 * NotamReadStateStoreProtocol as the briefing uses it (services/notamReadStateStore.ts implements it). `prune`, when
 * present, drops keys of NOTAMs no longer in the feed (Swift: only the concrete NotamReadStateStore prunes).
 */
export interface BriefingReadStore {
  isRead(notam: NotamKey): boolean;
  markRead(notam: NotamKey): void;
  markUnread(notam: NotamKey): void;
  markAllRead(notams: readonly NotamKey[]): void;
  prune?(keeping: readonly NotamKey[]): void;
}

/** Error.localizedDescription: an AppFailure reads as its user-facing description. */
function describe(error: unknown): string {
  if (error instanceof AppFailure) return errorDescription(error.error);
  return error instanceof Error ? error.message : String(error);
}

export class IsraelBriefingViewModel {
  private readonly fetcher: BriefingFetcher;
  private readonly readStore: BriefingReadStore;
  readonly now: () => number;

  constructor(
    readonly store: StoreApi<BriefingData>,
    deps: { fetcher: BriefingFetcher; readStore: BriefingReadStore; now?: () => number },
  ) {
    this.fetcher = deps.fetcher;
    this.readStore = deps.readStore;
    this.now = deps.now ?? Date.now;
  }

  private get state(): BriefingData {
    return this.store.getState();
  }

  private patch(next: Partial<BriefingData>): void {
    this.store.setState(next);
  }

  // MARK: Inputs the user sets

  get windowChoice(): WindowChoice {
    return this.state.windowChoice;
  }
  set windowChoice(value: WindowChoice) {
    this.patch({ windowChoice: value });
  }

  get distanceChoice(): DistanceChoice {
    return this.state.distanceChoice;
  }
  set distanceChoice(value: DistanceChoice) {
    this.patch({ distanceChoice: value });
  }

  /** Corridor half-width, nautical miles. */
  get corridorNM(): number {
    return this.state.corridorNM;
  }
  set corridorNM(value: number) {
    this.patch({ corridorNM: value });
  }

  get aerodromeFilter(): string {
    return this.state.aerodromeFilter;
  }
  set aerodromeFilter(value: string) {
    this.patch({ aerodromeFilter: value });
  }

  get unreadOnly(): boolean {
    return this.state.unreadOnly;
  }
  set unreadOnly(value: boolean) {
    this.patch({ unreadOnly: value });
  }

  get showStaleList(): boolean {
    return this.state.showStaleList;
  }
  set showStaleList(value: boolean) {
    this.patch({ showStaleList: value });
  }

  // MARK: Context from the caller

  get route(): BriefingRoute | null {
    return this.state.route;
  }
  /** Swift didSet: a route switches an unset distance filter to the route. */
  set route(value: BriefingRoute | null) {
    const distanceChoice = value !== null && this.state.distanceChoice === 'off' ? 'route' : this.state.distanceChoice;
    this.patch({ route: value, distanceChoice });
  }

  get ownship(): IsraelLatLon | null {
    return this.state.ownship;
  }
  set ownship(value: IsraelLatLon | null) {
    this.patch({ ownship: value });
  }

  // MARK: Loaded state

  get report(): IsraelNotamReport | null {
    return this.state.report;
  }
  get isLoading(): boolean {
    return this.state.isLoading;
  }
  get errorMessage(): string | null {
    return this.state.errorMessage;
  }

  // MARK: Loading

  async load(force = false): Promise<void> {
    if (this.state.isLoading) return;
    this.patch({ isLoading: true, errorMessage: null });
    try {
      const loaded = await this.fetcher(force);
      this.patch({ report: loaded, isLoading: false });
      this.readStore.prune?.(loaded.feed.items);
    } catch (error) {
      // Keep whatever was loaded before; the banner says the refresh failed.
      this.patch({ errorMessage: describe(error), isLoading: false });
    }
  }

  // MARK: Freshness

  get freshness(): DataFreshness | null {
    return briefingFreshness(this.state.report, this.now());
  }

  /** Fresh enough to list as current: the relay scraped the IAA within the NOTAM old limit. */
  get isCurrent(): boolean {
    return isCurrent(this.freshness);
  }

  /** Listed with an age badge but not as current (old), or hidden behind the stale gate (expired). */
  get isListable(): boolean {
    return isListable(this.freshness, this.state.showStaleList);
  }

  // MARK: Rows

  get window(): BriefingWindow {
    return briefingWindow(this.state.windowChoice, this.state.route, this.now());
  }

  get query(): BriefingQuery {
    return briefingQuery(this.state, this.now());
  }

  /** Rows for the current filters, closures first. Empty until a feed is loaded and listable. */
  get rows(): BriefingRow[] {
    return visibleRows(this.state, this.now(), this.isRead);
  }

  rowsIn(section: BriefingSection): BriefingRow[] {
    return rowsInSection(this.rows, section);
  }

  get unreadCount(): number {
    return unreadCount(this.rows, this.isRead);
  }

  // MARK: Read state

  isRead = (notam: IsraelNotam): boolean => this.readStore.isRead(notam);

  markRead(notam: IsraelNotam): void {
    this.readStore.markRead(notam);
    this.bumpRead();
  }

  markUnread(notam: IsraelNotam): void {
    this.readStore.markUnread(notam);
    this.bumpRead();
  }

  markAllRead(): void {
    this.readStore.markAllRead(this.rows.map((row) => row.notam));
    this.bumpRead();
  }

  private bumpRead(): void {
    this.patch({ readVersion: this.state.readVersion + 1 });
  }
}

/** What the sheet asks of the app shell (AppState, MapService, the system). Each is a no-op until I1 wires it. */
export interface BriefingActions {
  /** Close the sheet (Done, and after "Show on map"). */
  dismiss: () => void;
  /**
   * IsraelBriefingMapHighlight.show: draw and frame the NOTAM in the tint's MapColor, and switch to the map. false when
   * the map is not ready or the NOTAM has nothing drawable.
   */
  showOnMap: (notam: IsraelNotam, tint: HighlightTint) => boolean;
  /** IsraelBriefingMapHighlight.clear. */
  clearHighlight: () => void;
  openURL: (url: string) => void;
}

export const noBriefingActions: BriefingActions = {
  dismiss: () => undefined,
  showOnMap: () => false,
  clearHighlight: () => undefined,
  openURL: () => undefined,
};
