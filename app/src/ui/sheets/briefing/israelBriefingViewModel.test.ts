// Port of efb-212Tests/ViewModelTests/IsraelBriefingViewModelTests.swift (all 12): loading, staleness gate and read/unread
// tracking of the Israel NOTAM briefing, and the NOTAM read state store. MockIsraelNotamService becomes a fetcher that
// resolves or rejects; UserDefaults suites become fresh MemoryTextStorage instances.
import { makeBriefingRoute } from '../../../domain/israel/briefingFilter';
import { AppFailure } from '../../../domain/errors';
import type { IsraelNotam, IsraelNotamReport } from '../../../services/israelNotam';
import { NotamReadStateStore } from '../../../services/notamReadStateStore';
import { MemoryTextStorage } from '../../../services/testSupport';
import { hours, notam, t0 } from './__fixtures__/briefingFixtures';
import { DEFAULT_FILTERS } from './logic';
import { IsraelBriefingViewModel, briefing } from './store';

function report(items: IsraelNotam[], scrapedHoursAgo = 0.1, failed = false): IsraelNotamReport {
  return {
    feed: { generatedAt: hours(-scrapedHoursAgo), items, closures: items.flatMap((n) => n.closures) },
    fetchedAt: t0,
    refreshFailed: failed,
  };
}

type Outcome = { ok: true; value: IsraelNotamReport } | { ok: false; error: unknown };

async function viewModel(outcome: Outcome, store?: NotamReadStateStore) {
  const readStore = store ?? (await NotamReadStateStore.open(new MemoryTextStorage()));
  const slice = briefing.make({
    ...DEFAULT_FILTERS,
    route: null,
    ownship: null,
    report: null,
    isLoading: false,
    errorMessage: null,
    readVersion: 0,
  });
  const vm = new IsraelBriefingViewModel(slice, {
    fetcher: async () => {
      if (outcome.ok) return outcome.value;
      throw outcome.error;
    },
    readStore,
    now: () => t0,
  });
  return { vm, store: readStore };
}

const success = (value: IsraelNotamReport): Outcome => ({ ok: true, value });

describe('Israel briefing view model', () => {
  // MARK: Staleness

  test('freshFeedIsListedAndCurrent', async () => {
    const { vm } = await viewModel(success(report([notam('A')])));
    await vm.load();
    expect(vm.isCurrent).toBe(true);
    expect(vm.isListable).toBe(true);
    expect(vm.rows.map((r) => r.notam.id)).toEqual(['A']);
  });

  test('oldFeedIsListedButNotCurrent', async () => {
    const { vm } = await viewModel(success(report([notam('A')], 2)));
    await vm.load();
    expect(vm.freshness?.level).toBe('old');
    expect(vm.isCurrent).toBe(false);
    expect(vm.isListable).toBe(true);
  });

  test('expiredFeedIsHiddenUntilThePilotAsks', async () => {
    const { vm } = await viewModel(success(report([notam('A')], 7)));
    await vm.load();
    expect(vm.freshness?.level).toBe('expired');
    expect(vm.isCurrent).toBe(false);
    expect(vm.rows).toEqual([]);
    vm.showStaleList = true;
    expect(vm.rows.map((r) => r.notam.id)).toEqual(['A']);
  });

  test('failedFirstLoadKeepsNoListAndReportsTheError', async () => {
    const { vm } = await viewModel({ ok: false, error: new AppFailure({ kind: 'networkUnavailable' }) });
    await vm.load();
    expect(vm.report).toBeNull();
    expect(vm.errorMessage).not.toBeNull();
    expect(vm.rows).toEqual([]);
  });

  // MARK: Read state

  test('notamsStartUnreadAndMarkAllReadClearsTheCount', async () => {
    const { vm } = await viewModel(success(report([notam('A'), notam('B')])));
    await vm.load();
    expect(vm.unreadCount).toBe(2);
    vm.markAllRead();
    expect(vm.unreadCount).toBe(0);
    const allRead = vm.rows.every((r) => vm.isRead(r.notam));
    expect(allRead).toBe(true);
  });

  test('unreadOnlyHidesReadNotams', async () => {
    const { vm } = await viewModel(success(report([notam('A'), notam('B')])));
    await vm.load();
    vm.markRead(notam('A'));
    vm.unreadOnly = true;
    expect(vm.rows.map((r) => r.notam.id)).toEqual(['B']);
  });

  test('aReplacementNotamShowsUnreadEvenWhenTheOriginalWasRead', async () => {
    const original = notam('C100/26', { created: hours(-48) });
    const replacement = notam('C100/26', { type: 'NOTAMR', created: hours(-1) });
    const { vm } = await viewModel(success(report([replacement])));
    await vm.load();
    vm.markRead(original);
    expect(vm.isRead(original)).toBe(true);
    expect(vm.isRead(replacement)).toBe(false);
    expect(vm.unreadCount).toBe(1);
  });

  // MARK: Route

  test('settingARouteSelectsRouteDistanceAndRouteAerodromesSortFirst', async () => {
    const { vm } = await viewModel(
      success(report([notam('BG', { location: 'LLBG' }), notam('HZ', { location: 'LLHZ' })])),
    );
    await vm.load();
    vm.route = makeBriefingRoute({ codes: ['LLHZ', 'GALIM'], points: [] });
    expect(vm.distanceChoice).toBe('route');
    expect(vm.rows.map((r) => r.notam.id)).toEqual(['HZ', 'BG']);
  });
});

describe('NOTAM read state store', () => {
  test('readStatePersistsAcrossInstances', async () => {
    const defaults = new MemoryTextStorage();
    const n = notam('A');
    const first = await NotamReadStateStore.open(defaults);
    first.markRead(n);
    await first.flush();
    expect((await NotamReadStateStore.open(defaults)).isRead(n)).toBe(true);
  });

  test('sameIdWithANewCreatedStampIsUnread', async () => {
    const store = await NotamReadStateStore.open(new MemoryTextStorage());
    store.markRead(notam('C1/26', { created: hours(-10) }));
    expect(store.isRead(notam('C1/26', { created: hours(-1) }))).toBe(false);
  });

  test('markUnreadUndoesMarkRead', async () => {
    const store = await NotamReadStateStore.open(new MemoryTextStorage());
    const n = notam('A');
    store.markRead(n);
    store.markUnread(n);
    expect(store.isRead(n)).toBe(false);
  });

  test('pruneDropsKeysOfNotamsNoLongerInTheFeed', async () => {
    const defaults = new MemoryTextStorage();
    const store = await NotamReadStateStore.open(defaults);
    const gone = notam('GONE');
    const kept = notam('KEPT');
    store.markAllRead([gone, kept]);
    store.prune([kept]);
    await store.flush();
    const reloaded = await NotamReadStateStore.open(defaults);
    expect(reloaded.isRead(kept)).toBe(true);
    expect(reloaded.isRead(gone)).toBe(false);
  });
});

describe('IsraelBriefingViewModel, JS-only', () => {
  test('a load prunes read keys of NOTAMs that left the feed and a failed refresh keeps the last report', async () => {
    const store = await NotamReadStateStore.open(new MemoryTextStorage());
    store.markRead(notam('GONE'));
    let fail = false;
    const feed = report([notam('A')]);
    const vm = new IsraelBriefingViewModel(briefing.make(), {
      fetcher: async () => {
        if (fail) throw new Error('offline');
        return feed;
      },
      readStore: store,
      now: () => t0,
    });
    await vm.load();
    expect(store.isRead(notam('GONE'))).toBe(false);
    fail = true;
    await vm.load(true);
    expect(vm.report).toBe(feed);
    expect(vm.errorMessage).toBe('offline');
    expect(vm.isLoading).toBe(false);
  });

  test('a second load while one is in flight is ignored', async () => {
    let calls = 0;
    const vm = new IsraelBriefingViewModel(briefing.make(), {
      fetcher: async () => {
        calls += 1;
        return report([notam('A')]);
      },
      readStore: await NotamReadStateStore.open(),
      now: () => t0,
    });
    await Promise.all([vm.load(), vm.load()]);
    expect(calls).toBe(1);
  });

  test('a route leaves a distance filter the pilot already chose alone', async () => {
    const { vm } = await viewModel(success(report([])));
    vm.distanceChoice = 'ownship';
    vm.route = makeBriefingRoute({ codes: ['LLHZ'], points: [] });
    expect(vm.distanceChoice).toBe('ownship');
  });
});
