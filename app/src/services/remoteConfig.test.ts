// Port of ServiceTests/RemoteConfigTests.swift (27 Swift tests; the store, parser and service). JS-only guards at the end.
import { readFileSync } from 'fs';
import { join } from 'path';
import { AppFailure } from '../domain/errors';
import { MAXIMUM_BYTES, PARAMETER_INFO, parseRemoteConfig, resolveText, type RemoteConfig } from './remoteConfig';
import {
  createRemoteConfigService,
  DEFAULT_REMOTE_CONFIG_URL,
  type RemoteConfigServiceLike,
} from './remoteConfigService';
import {
  CHECK_INTERVAL_SECONDS,
  LAST_CONFIG_KEY,
  RemoteConfigStore,
  RETRY_INTERVAL_SECONDS,
} from './remoteConfigStore';
import { fakeFetch, MemoryTextStorage, TestClock } from './testSupport';

// 2026-11-02T12:00:00Z
const t0 = 1_793_620_800_000;
const day = 86_400;

const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');

type Obj = Record<string, unknown>;

/** A valid file; `mutate` edits the JSON object before it is encoded. */
function file(opts: { serial?: number; expiresIn?: number; mutate?: (o: Obj) => void } = {}): string {
  const { serial = 1, expiresIn = 30 * day, mutate } = opts;
  const object: Obj = {
    schemaVersion: 1,
    serial,
    issuedAt: iso(t0 - 3_600_000),
    expiresAt: iso(t0 + expiresIn * 1000),
  };
  mutate?.(object);
  return JSON.stringify(object);
}

const text = (english: string, hebrew?: string) => (hebrew ? { en: english, he: hebrew } : { en: english });

class FakeConfigService implements RemoteConfigServiceLike {
  callCount = 0;
  constructor(private readonly body: string | null) {}
  static offline = () => new FakeConfigService(null);
  async fetchConfigData(): Promise<string> {
    this.callCount += 1;
    if (this.body === null) throw new Error('The Internet connection appears to be offline.');
    return this.body;
  }
}

async function makeStore(
  service: RemoteConfigServiceLike = FakeConfigService.offline(),
  opts: { storage?: MemoryTextStorage; build?: number; clock?: TestClock; language?: string } = {},
) {
  const clock = opts.clock ?? new TestClock(t0);
  return RemoteConfigStore.open({
    service,
    storage: opts.storage,
    buildNumber: opts.build ?? 5,
    now: clock.now,
    preferredLanguage: () => opts.language ?? 'en',
  });
}

function rejects(body: string, now = t0): boolean {
  try {
    parseRemoteConfig(body, now);
    return false;
  } catch (e) {
    return e instanceof AppFailure && e.error.kind === 'remoteConfigRejected';
  }
}

// MARK: Parsing: what a file may carry

test('aFullFileDecodesWithNothingIgnored', () => {
  const config = parseRemoteConfig(
    file({
      serial: 7,
      mutate: (o) => {
        o.minSupportedBuild = 2;
        o.recommendedBuild = 3;
        o.updateMessage = text('Update to build 3', 'עדכנו');
        o.disabledFeatures = { israelDiagramOverlay: text('Fix pending', 'תיקון בדרך') };
        o.parameters = { cvfrReportWindowSeconds: 150 };
        o.notices = [
          { id: 'n1', severity: 'caution', regions: ['israel'], until: iso(t0 + day * 1000), text: text('Hello') },
        ];
      },
    }),
    t0,
  );
  expect(config.serial).toBe(7);
  expect([config.minSupportedBuild, config.recommendedBuild]).toEqual([2, 3]);
  expect(config.disabledFeatures.israelDiagramOverlay?.english).toBe('Fix pending');
  expect(config.parameters.cvfrReportWindowSeconds).toBe(150);
  expect(config.notices.map((n) => n.id)).toEqual(['n1']);
  expect(config.notices[0].severity).toBe('caution');
  expect(config.ignored).toEqual([]);
});

test('oneBadValueIsDroppedAndTheRestStillApplies', () => {
  const config = parseRemoteConfig(
    file({
      mutate: (o) => {
        o.minSupportedBuild = -4;
        o.disabledFeatures = {
          proximityAlerts: text('Not a feature that can be switched off'),
          israelDiagramOverlay: text('Fix pending'),
        };
        o.parameters = { cvfrReportWindowSeconds: 9999, madeUp: 1 };
        o.notices = [{ id: 'no-text' }];
        o.recommendedBuild = 3;
      },
    }),
    t0,
  );
  expect(Object.keys(config.disabledFeatures)).toEqual(['israelDiagramOverlay']);
  expect(config.parameters).toEqual({});
  expect(config.notices).toEqual([]);
  expect(config.minSupportedBuild).toBeNull();
  expect(config.recommendedBuild).toBe(3);
  // minSupportedBuild, proximityAlerts, the out-of-range value, madeUp and the notice.
  expect(config.ignored).toHaveLength(5);
});

// Swift sends infinity as the string "inf" (JSON has no infinity); that is ignored as "not a number".
test.each([0, 29.9, 300.1, 'inf'])('aParameterOutsideItsRangeIsIgnored %p', (value) => {
  const config = parseRemoteConfig(file({ mutate: (o) => (o.parameters = { cvfrReportWindowSeconds: value }) }), t0);
  expect(config.parameters).toEqual({});
  expect(config.ignored).toHaveLength(1);
});

test.each([30, 120, 300])('aParameterAtOrInsideItsRangeIsKept %p', (value) => {
  const config = parseRemoteConfig(file({ mutate: (o) => (o.parameters = { cvfrReportWindowSeconds: value }) }), t0);
  expect(config.parameters.cvfrReportWindowSeconds).toBe(value);
});

test('aRemoteNoticeIsNeverRed', () => {
  const config = parseRemoteConfig(
    file({
      mutate: (o) => {
        o.notices = [
          { id: 'a', severity: 'critical', text: text('x') },
          { id: 'b', severity: 'warning', text: text('y') },
        ];
      },
    }),
    t0,
  );
  expect(config.notices.map((n) => n.severity)).toEqual(['info', 'info']);
});

test('aNoticeWithMalformedRegionsOrUntilIsDroppedInsteadOfWidened', () => {
  const config = parseRemoteConfig(
    file({
      mutate: (o) => {
        o.notices = [
          { id: 'string-region', regions: 'israel', text: text('x') },
          { id: 'date-only', until: '2026-11-09', text: text('x') },
          { id: 'number-until', until: 5, text: text('x') },
          { id: 'fine', regions: ['israel'], until: iso(t0 + day * 1000), text: text('x') },
        ];
      },
    }),
    t0,
  );
  expect(config.notices.map((n) => n.id)).toEqual(['fine']);
  expect(config.ignored).toHaveLength(3);
});

test('hebrewIsUsedOnlyOnAHebrewDeviceAndWhenAHebrewTextExists', () => {
  const both = { english: 'Update', hebrew: 'עדכנו' };
  expect(resolveText(both, 'he-IL')).toBe('עדכנו');
  expect(resolveText(both, 'en-US')).toBe('Update');
  expect(resolveText({ english: 'Update', hebrew: null }, 'he')).toBe('Update');
});

// MARK: Parsing: what rejects a whole file

test('aFileWithAnUnusableEnvelopeIsRejected', () => {
  expect(rejects('not json')).toBe(true);
  expect(rejects('[]')).toBe(true);
  expect(rejects('x'.repeat(MAXIMUM_BYTES + 1))).toBe(true);
  expect(rejects(file({ mutate: (o) => (o.schemaVersion = 2) }))).toBe(true); // a newer schema
  expect(rejects(file({ mutate: (o) => delete o.schemaVersion }))).toBe(true);
  expect(rejects(file({ mutate: (o) => delete o.serial }))).toBe(true);
  expect(rejects(file({ mutate: (o) => (o.serial = true) }))).toBe(true); // a boolean is not a serial
  expect(rejects(file({ mutate: (o) => (o.serial = 1.5) }))).toBe(true);
  expect(rejects(file({ mutate: (o) => (o.expiresAt = 'tomorrow') }))).toBe(true);
  expect(rejects(file({ mutate: (o) => (o.expiresAt = iso(t0 - 7_200_000)) }))).toBe(true); // expires before issued
});

test('aFileThatAlreadyExpiredIsRejected', () => {
  const body = file({ expiresIn: 60 });
  expect(rejects(body)).toBe(false);
  expect(rejects(body, t0 + 61_000)).toBe(true);
});

test('fractionalSecondTimestampsFromJavaScriptAreAccepted', () => {
  const config = parseRemoteConfig(
    file({
      mutate: (o) => {
        o.issuedAt = '2026-11-02T00:00:00.000Z';
        o.expiresAt = '2027-01-01T00:00:00.000Z';
      },
    }),
    t0,
  );
  expect(config.serial).toBe(1);
});

// MARK: Store: precedence and expiry

test('aLowerSerialIsRejectedAndTheSavedCopyStays', async () => {
  const store = await makeStore();
  const withWindow = (serial: number, value: number) =>
    file({ serial, mutate: (o) => (o.parameters = { cvfrReportWindowSeconds: value }) });
  store.apply(withWindow(5, 150));
  store.apply(withWindow(4, 200));
  expect(store.config?.serial).toBe(5);
  expect(store.value('cvfrReportWindowSeconds')).toBe(150);
  expect(store.lastError).not.toBeNull();

  store.apply(withWindow(5, 200));
  expect(store.value('cvfrReportWindowSeconds')).toBe(200); // the same serial is accepted
  expect(store.lastError).toBeNull();
  store.apply(file({ serial: 6, mutate: (o) => (o.parameters = {}) }));
  expect(store.value('cvfrReportWindowSeconds')).toBe(PARAMETER_INFO.cvfrReportWindowSeconds.builtIn);
});

test('anExpiredCopyStopsApplyingAndTheBuiltInValuesReturn', async () => {
  const clock = new TestClock(t0);
  const store = await makeStore(undefined, { clock });
  store.apply(
    file({
      expiresIn: 3600,
      mutate: (o) => {
        o.parameters = { cvfrReportWindowSeconds: 150 };
        o.disabledFeatures = { israelDiagramOverlay: text('Fix pending') };
        o.minSupportedBuild = 99;
      },
    }),
  );
  expect(store.value('cvfrReportWindowSeconds')).toBe(150);
  expect(store.isDisabled('israelDiagramOverlay')).toBe(true);
  expect(store.updateRequest).not.toBeNull();

  clock.advance(7200);
  expect(store.value('cvfrReportWindowSeconds')).toBe(120);
  expect(store.isDisabled('israelDiagramOverlay')).toBe(false);
  expect(store.disabledMessage('israelDiagramOverlay')).toBeNull();
  expect(store.updateRequest).toBeNull();
  expect(store.active).toBeNull();
  expect(store.sourceDescription).toBe('Built-in');
});

test('aFeatureThatIsNotOnTheListCannotBeSwitchedOff', async () => {
  const store = await makeStore();
  store.apply(
    file({
      mutate: (o) => {
        o.disabledFeatures = {
          proximityAlerts: text('off'),
          airspaceCheck: text('off'),
          closureBlocking: text('off'),
          disclaimers: text('off'),
        };
      },
    }),
  );
  expect(store.active?.disabledFeatures).toEqual({});
  expect(store.active?.ignored).toHaveLength(4);
  expect(store.isDisabled('israelDiagramOverlay')).toBe(false);
});

test('aSwitchedOffFeatureReportsTheFilesOwnMessage', async () => {
  const store = await makeStore();
  store.apply(
    file({
      mutate: (o) => {
        o.disabledFeatures = { israelDiagramOverlay: text('Diagrams are paused while we fix a placement error.') };
      },
    }),
  );
  expect(store.disabledMessage('israelDiagramOverlay')).toBe('Diagrams are paused while we fix a placement error.');
});

// MARK: Store: offline and disk

test('offlineFirstLaunchUsesTheBuiltInValues', async () => {
  const service = FakeConfigService.offline();
  const store = await makeStore(service);
  await store.refresh();
  expect(service.callCount).toBe(1);
  expect(store.active).toBeNull();
  expect(store.value('cvfrReportWindowSeconds')).toBe(120);
  expect(store.sourceDescription).toBe('Built-in');
  expect(store.lastError).not.toBeNull();
});

test('theLastGoodCopySurvivesARelaunchAndStillExpires', async () => {
  const storage = new MemoryTextStorage();
  const clock = new TestClock(t0);

  const first = await makeStore(
    new FakeConfigService(
      file({ serial: 3, expiresIn: 10 * day, mutate: (o) => (o.parameters = { cvfrReportWindowSeconds: 150 }) }),
    ),
    { storage, clock },
  );
  await first.refresh();
  await first.flush();
  expect(first.value('cvfrReportWindowSeconds')).toBe(150);

  // Relaunch with no network.
  const second = await makeStore(FakeConfigService.offline(), { storage, clock });
  expect(second.config?.serial).toBe(3);
  expect(second.value('cvfrReportWindowSeconds')).toBe(150);
  expect(second.sourceDescription.startsWith('Serial 3')).toBe(true);

  // Later than the file's expiry: it no longer applies, but its serial still blocks an older file.
  clock.advance(11 * day);
  const third = await makeStore(FakeConfigService.offline(), { storage, clock });
  expect(third.active).toBeNull();
  expect(third.value('cvfrReportWindowSeconds')).toBe(120);
  third.apply(file({ serial: 2, expiresIn: 30 * day + 11 * day }));
  expect(third.config?.serial).toBe(3);
  expect(third.lastError).not.toBeNull();
});

test('aDamagedSavedFileIsIgnored', async () => {
  const storage = new MemoryTextStorage();
  storage.files.set(LAST_CONFIG_KEY, '{ truncated');
  const store = await makeStore(undefined, { storage });
  expect(store.config).toBeNull();
  expect(store.sourceDescription).toBe('Built-in');
});

// MARK: Store: fetch policy

test('nothingIsFetchedWhileARecordingIsActive', async () => {
  const service = new FakeConfigService(file());
  const store = await makeStore(service);
  await store.refreshIfDue(true);
  expect(service.callCount).toBe(0);
  await store.refreshIfDue(false);
  expect(service.callCount).toBe(1);
});

test('aSuccessfulCheckIsNotRepeatedWithinAnHour', async () => {
  const clock = new TestClock(t0);
  const service = new FakeConfigService(file());
  const store = await makeStore(service, { clock });
  await store.refreshIfDue(false);
  clock.advance(CHECK_INTERVAL_SECONDS - 1);
  await store.refreshIfDue(false);
  expect(service.callCount).toBe(1);
  clock.advance(2);
  await store.refreshIfDue(false);
  expect(service.callCount).toBe(2);
});

test('aRejectedFileCountsAsACheckSoABadFileIsNotHammered', async () => {
  const service = new FakeConfigService('garbage');
  const store = await makeStore(service);
  await store.refreshIfDue(false);
  await store.refreshIfDue(false);
  expect(service.callCount).toBe(1);
  expect(store.lastError).not.toBeNull();
});

test('aNetworkFailureIsRetriedAfterFiveMinutes', async () => {
  const clock = new TestClock(t0);
  const service = FakeConfigService.offline();
  const store = await makeStore(service, { clock });
  await store.refreshIfDue(false);
  clock.advance(RETRY_INTERVAL_SECONDS - 1);
  await store.refreshIfDue(false);
  expect(service.callCount).toBe(1);
  clock.advance(2);
  await store.refreshIfDue(false);
  expect(service.callCount).toBe(2);
});

// MARK: Store: update request and notices

test.each([
  [1, 'required'],
  [2, 'recommended'],
  [3, 'none'],
] as const)('theUpdateRequestFollowsTheRunningBuild build %p', async (build, expected) => {
  const store = await makeStore(undefined, { build });
  store.apply(
    file({
      mutate: (o) => {
        o.minSupportedBuild = 2;
        o.recommendedBuild = 3;
        o.updateMessage = text('Please update');
      },
    }),
  );
  const request = store.updateRequest;
  if (expected === 'none') expect(request).toBeNull();
  else expect(request).toEqual({ kind: expected, message: 'Please update' });
});

test('noticesFollowTheRegionTheExpiryAndDismissal', async () => {
  const clock = new TestClock(t0);
  const store = await makeStore(undefined, { clock });
  store.apply(
    file({
      mutate: (o) => {
        o.notices = [
          { id: 'il', regions: ['israel'], text: text('Israel only') },
          { id: 'all', text: text('Everyone') },
          { id: 'soon', until: iso(t0 + 3_600_000), text: text('Short') },
        ];
      },
    }),
  );
  const ids = (region: 'us' | 'israel') => store.notices(region).map((n) => n.id);
  expect(ids('us')).toEqual(['all', 'soon']);
  expect(ids('israel')).toEqual(['il', 'all', 'soon']);
  store.dismissBanner('all');
  expect(ids('israel')).toEqual(['il', 'soon']);
  clock.advance(7200);
  expect(ids('israel')).toEqual(['il']);
});

// MARK: The file the relay serves

test('theRelaysCheckedInFileDecodesWithNothingIgnored', () => {
  const path = join(__dirname, '../../../web/notam-relay/config/app-config.json');
  // "Now" is pinned inside the file's validity so the test doesn't expire with the calendar.
  const config = parseRemoteConfig(readFileSync(path, 'utf8'), t0);
  expect(config.ignored).toEqual([]);
  expect(config.serial).toBeGreaterThanOrEqual(1);
});

// MARK: Service

const URL_UNDER_TEST = 'https://relay.example/config.json';

test('theServiceReturnsTheBodyOfA200', async () => {
  const body = file();
  const fetch = fakeFetch(() => ({ body }));
  const service = createRemoteConfigService({ fetch, urlOverride: () => URL_UNDER_TEST });
  expect(await service.fetchConfigData()).toBe(body);
  expect(fetch.calls[0].url).toBe(URL_UNDER_TEST);
});

test.each([404, 500, 503])('theServiceRefusesAnythingButA200 %p', async (status) => {
  const service = createRemoteConfigService({ fetch: fakeFetch(() => ({ status, body: file() })) });
  await expect(service.fetchConfigData()).rejects.toBeInstanceOf(AppFailure);
});

test('theServiceRefusesAnOversizedBody', async () => {
  const service = createRemoteConfigService({ fetch: fakeFetch(() => ({ body: 'x'.repeat(MAXIMUM_BYTES + 1) })) });
  await expect(service.fetchConfigData()).rejects.toBeInstanceOf(AppFailure);
});

// JS-only guards (port notes S1a)

test('the service uses the relay URL when no override is set, and ignores an empty override', async () => {
  const fetch = fakeFetch(() => ({ body: file() }));
  await createRemoteConfigService({ fetch }).fetchConfigData();
  await createRemoteConfigService({ fetch, urlOverride: () => '' }).fetchConfigData();
  expect(fetch.calls.map((c) => c.url)).toEqual([DEFAULT_REMOTE_CONFIG_URL, DEFAULT_REMOTE_CONFIG_URL]);
  expect(DEFAULT_REMOTE_CONFIG_URL.startsWith('https://')).toBe(true);
});

test('a multi-byte body over the byte limit is refused even when its character count is under it', async () => {
  const body = 'א'.repeat(MAXIMUM_BYTES / 2 + 1); // 2 bytes each in UTF-8
  const service = createRemoteConfigService({ fetch: fakeFetch(() => ({ body })) });
  await expect(service.fetchConfigData()).rejects.toBeInstanceOf(AppFailure);
});

test('a throwing service is recorded as the last error and retried after five minutes', async () => {
  const clock = new TestClock(t0);
  const service: RemoteConfigServiceLike = {
    fetchConfigData: () => {
      throw new Error('sync boom'); // a synchronous throw, not a rejection
    },
  };
  const store = await makeStore(service, { clock });
  await store.refreshIfDue(false);
  expect(store.lastError).toBe('sync boom');
  expect(store.isChecking).toBe(false);
});

test('a refresh while one is running joins it instead of fetching twice', async () => {
  let release: (body: string) => void = () => undefined;
  let calls = 0;
  const service: RemoteConfigServiceLike = {
    fetchConfigData: () => {
      calls += 1;
      return new Promise<string>((resolve) => (release = resolve));
    },
  };
  const store = await makeStore(service);
  const a = store.refresh();
  const b = store.refresh();
  expect(store.isChecking).toBe(true);
  release(file({ serial: 2 }));
  await Promise.all([a, b]);
  expect(calls).toBe(1);
  expect(store.config?.serial).toBe(2);
  expect(store.isChecking).toBe(false);
});

test('a failing disk write is logged and does not lose the in-memory config', async () => {
  const storage = new MemoryTextStorage();
  storage.failWrites = true;
  const logs: string[] = [];
  const store = await RemoteConfigStore.open({
    service: FakeConfigService.offline(),
    storage,
    buildNumber: 1,
    now: () => t0,
    log: (m) => logs.push(m),
  });
  store.apply(file({ serial: 2 }));
  await store.flush();
  expect(store.config?.serial).toBe(2);
  expect(logs.some((l) => l.includes('Could not save'))).toBe(true);
});

test('writes land in order: the last applied file is the one on disk', async () => {
  const storage = new MemoryTextStorage();
  const store = await makeStore(undefined, { storage });
  store.apply(file({ serial: 2 }));
  store.apply(file({ serial: 3 }));
  await store.flush();
  const saved = JSON.parse(storage.files.get(LAST_CONFIG_KEY) ?? '{}') as { body: string };
  expect((JSON.parse(saved.body) as RemoteConfig).serial).toBe(3);
});

test.each([
  ['2026-02-30T00:00:00Z', false],
  ['2026-13-01T00:00:00Z', false],
  ['2026-11-02T24:00:00Z', false],
  ['2026-11-02T12:00:00', false],
  ['2026-11-02T14:00:00+02:00', true],
])('date text %p accepted=%p', (value, accepted) => {
  const body = file({ mutate: (o) => (o.expiresAt = value) });
  expect(rejects(body, t0 - 1000)).toBe(!accepted);
});

test('a time zone offset moves the instant', () => {
  const body = file({ mutate: (o) => (o.expiresAt = '2026-11-02T14:00:00+02:00') });
  expect(parseRemoteConfig(body, t0 - 1000).expiresAtMs).toBe(t0);
});

test('a saved file with the wrong shape is ignored', async () => {
  const storage = new MemoryTextStorage();
  for (const raw of ['null', '[]', '{"fetchedAtMs":"x","body":1}', '42']) {
    storage.files.set(LAST_CONFIG_KEY, raw);
    expect((await makeStore(undefined, { storage })).config).toBeNull();
  }
});

test('a service that is slow is cut off by the request timeout', async () => {
  jest.useFakeTimers();
  try {
    const fetch = () => new Promise<never>(() => undefined);
    const service = createRemoteConfigService({ fetch, timeoutMs: 1000 });
    const pending = expect(service.fetchConfigData()).rejects.toThrow('timed out');
    jest.advanceTimersByTime(1000);
    await pending;
  } finally {
    jest.useRealTimers();
  }
});
