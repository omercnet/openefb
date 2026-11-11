import type { CounterRow } from '../domain/telemetry/schema';
import { TELEMETRY_TIMEOUT_MS, createHttpTransport, telemetryEndpoint } from './telemetryTransport';

const ENDPOINT = 'https://openefb-telemetry.omerc.workers.dev/v1/counters';
const ROWS: CounterRow[] = [
  { event: 'Recording.started', app: '1.2.0', platform: 'ios', update: 'embedded', region: 'us', count: 2 },
  {
    event: 'Navigation.screen',
    params: { screen: 'map' },
    app: '1.2.0',
    platform: 'ios',
    update: 'embedded',
    region: 'us',
    count: 1,
  },
];

/** What the transport reads of a Response: its status and its JSON body (a missing body is one that is not JSON). */
const reply = (status: number, body?: unknown) =>
  ({
    status,
    json: () =>
      body === undefined ? Promise.reject(new SyntaxError('Unexpected end of JSON input')) : Promise.resolve(body),
  }) as unknown as Response;

const ACCEPTED = { accepted: 2, dropped: 0 };

function recordingFetch(response: Response | (() => Promise<Response>) = reply(202, ACCEPTED)) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = jest.fn((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return typeof response === 'function' ? response() : Promise.resolve(response);
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

describe('telemetryEndpoint', () => {
  describe('in a release build', () => {
    test.each([
      ['https://openefb-telemetry.omerc.workers.dev', ENDPOINT],
      ['https://openefb-telemetry.omerc.workers.dev/', ENDPOINT],
      ['  https://openefb-telemetry.omerc.workers.dev  ', ENDPOINT],
      ['HTTPS://OpenEFB-Telemetry.Omerc.Workers.Dev', ENDPOINT],
      ['https://telemetry.example.org:8443', 'https://telemetry.example.org:8443/v1/counters'],
      ['https://a.b', 'https://a.b/v1/counters'],
      ['https://a.b:1', 'https://a.b:1/v1/counters'],
      ['https://a.b:65535', 'https://a.b:65535/v1/counters'],
    ])('%s -> %s', (setting, endpoint) => {
      expect(telemetryEndpoint(setting, false)).toBe(endpoint);
    });

    test.each([
      ['nothing', undefined],
      ['an empty string', ''],
      ['blanks', '   '],
      ['plain http', 'http://openefb-telemetry.omerc.workers.dev'],
      ['plain http to the machine itself', 'http://localhost:8788'],
      ['another scheme', 'ftp://example.com'],
      ['no scheme', 'openefb-telemetry.omerc.workers.dev'],
      ['no host', 'https://'],
      ['credentials in the address', 'https://user:secret@example.com'],
      ['a path', 'https://example.com/telemetry'],
      ['the endpoint path itself', 'https://example.com/v1/counters'],
      ['a query', 'https://example.com?key=1'],
      ['a fragment', 'https://example.com#top'],
      ['a space in the host', 'https://exa mple.com'],
      ['an empty label', 'https://example..com'],
      ['a label that starts with a hyphen', 'https://-example.com'],
      ['a port of 0', 'https://example.com:0'],
      ['a port just over 65535', 'https://example.com:65536'],
      ['a port far over 65535', 'https://example.com:99999'],
      ['a port that is not a number', 'https://example.com:abc'],
      ['two hosts', 'https://a.com,https://b.com'],
    ])('uses nothing for %s', (_name, setting) => {
      expect(telemetryEndpoint(setting, false)).toBeNull();
    });
  });

  describe('in a development build', () => {
    test.each([
      ['http://localhost:8788', 'http://localhost:8788/v1/counters'],
      ['http://127.0.0.1:8788', 'http://127.0.0.1:8788/v1/counters'],
      ['http://[::1]:8788', 'http://[::1]:8788/v1/counters'],
      ['http://10.0.2.2:8788', 'http://10.0.2.2:8788/v1/counters'], // the Android emulator's name for the host machine
      ['https://localhost:8788', 'https://localhost:8788/v1/counters'],
    ])('%s -> %s: the machine itself', (setting, endpoint) => {
      expect(telemetryEndpoint(setting, true)).toBe(endpoint);
    });

    test.each([
      ['the deployed Worker', 'https://openefb-telemetry.omerc.workers.dev'],
      ['another host over http', 'http://example.com'],
      ['a look-alike host', 'http://localhost.example.com:8788'],
      ['a look-alike address', 'http://127.0.0.1.example.com'],
    ])('never sends counts of a development build to %s', (_name, setting) => {
      expect(telemetryEndpoint(setting, true)).toBeNull();
    });
  });
});

describe('createHttpTransport', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('the request', () => {
    test('is a POST of the rows in a versioned batch, with nothing but a content type', async () => {
      const { fetchFn, calls } = recordingFetch();
      await createHttpTransport(ENDPOINT, { fetch: fetchFn }).send(ROWS);

      expect(calls).toHaveLength(1);
      const { url, init } = calls[0] as (typeof calls)[number];
      expect(url).toBe(ENDPOINT);
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({ 'content-type': 'application/json' });
      expect(init.credentials).toBe('omit');
      expect(JSON.parse(init.body as string)).toEqual({ v: 1, counters: ROWS });
      expect(Object.keys(init).sort()).toEqual(['body', 'credentials', 'headers', 'method', 'signal']);
    });

    test('goes to the global fetch unless one is given', async () => {
      const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(reply(202, ACCEPTED));
      await expect(createHttpTransport(ENDPOINT).send(ROWS)).resolves.toBe('sent');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]?.[0]).toBe(ENDPOINT);
    });
  });

  describe('the outcome', () => {
    test.each([
      ['taken', { accepted: 2, dropped: 0 }],
      ['taken, some rows not known to the server', { accepted: 1, dropped: 1 }],
      ['taken apart: none of it known to the server', { accepted: 0, dropped: 2 }],
    ])('202 and %s is sent', async (_name, body) => {
      const { fetchFn } = recordingFetch(reply(202, body));
      await expect(createHttpTransport(ENDPOINT, { fetch: fetchFn }).send(ROWS)).resolves.toBe('sent');
    });

    test.each([
      ['400', 400],
      ['404', 404],
      ['405', 405],
      ['413', 413],
      ['422', 422],
      ['401', 401],
    ])('%s is a refusal for good: drop', async (_name, status) => {
      const { fetchFn } = recordingFetch(reply(status, { error: 'x' }));
      await expect(createHttpTransport(ENDPOINT, { fetch: fetchFn }).send(ROWS)).resolves.toBe('drop');
    });

    test.each([
      ['408 request timeout', 408],
      ['425 too early', 425],
      ['429 too many requests', 429],
      ['500', 500],
      ['502', 502],
      ['503 (the Worker has no dataset bound)', 503],
      ['504', 504],
    ])('%s is worth trying again: retry', async (_name, status) => {
      const { fetchFn } = recordingFetch(reply(status, 'later'));
      await expect(createHttpTransport(ENDPOINT, { fetch: fetchFn }).send(ROWS)).resolves.toBe('retry');
    });

    test.each([
      ['a 200 (a captive portal page, not the Worker)', 200],
      ['a 204', 204],
      ['a 301', 301],
      ['a 302', 302],
      ['a 307', 307],
      ['a 100', 100],
    ])('%s is not what the Worker answers: retry', async (_name, status) => {
      const { fetchFn } = recordingFetch(reply(status, ACCEPTED));
      await expect(createHttpTransport(ENDPOINT, { fetch: fetchFn }).send(ROWS)).resolves.toBe('retry');
    });

    test.each([
      ['a body that is not JSON', undefined],
      ['a body that is not an object', 'accepted'],
      ['a body without a count', { dropped: 0 }],
      ['a body whose count is not a number', { accepted: '2', dropped: 0 }],
      ['null', null],
    ])('a 202 with %s is not the Worker: retry', async (_name, body) => {
      const { fetchFn } = recordingFetch(reply(202, body));
      await expect(createHttpTransport(ENDPOINT, { fetch: fetchFn }).send(ROWS)).resolves.toBe('retry');
    });

    test('a request that fails (no network) is retry', async () => {
      const { fetchFn } = recordingFetch(() => Promise.reject(new TypeError('Network request failed')));
      await expect(createHttpTransport(ENDPOINT, { fetch: fetchFn }).send(ROWS)).resolves.toBe('retry');
    });

    test('a fetch that throws at once is retry', async () => {
      const fetchFn = jest.fn(() => {
        throw new Error('bug');
      }) as unknown as typeof fetch;
      await expect(createHttpTransport(ENDPOINT, { fetch: fetchFn }).send(ROWS)).resolves.toBe('retry');
    });
  });

  describe('the time limit', () => {
    function hangingFetch() {
      const signals: AbortSignal[] = [];
      const fetchFn = jest.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init.signal as AbortSignal;
            signals.push(signal);
            signal.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      ) as unknown as typeof fetch;
      return { fetchFn, signals };
    }

    test('gives up on a request after ten seconds, aborts it, and says retry', async () => {
      jest.useFakeTimers();
      const { fetchFn, signals } = hangingFetch();
      const sending = createHttpTransport(ENDPOINT, { fetch: fetchFn }).send(ROWS);

      expect(TELEMETRY_TIMEOUT_MS).toBe(10_000);
      jest.advanceTimersByTime(TELEMETRY_TIMEOUT_MS - 1);
      expect(signals[0]?.aborted).toBe(false);
      jest.advanceTimersByTime(1);
      expect(signals[0]?.aborted).toBe(true);
      await expect(sending).resolves.toBe('retry');
    });

    test('takes the limit from the options', async () => {
      jest.useFakeTimers();
      const { fetchFn, signals } = hangingFetch();
      const sending = createHttpTransport(ENDPOINT, { fetch: fetchFn, timeoutMs: 250 }).send(ROWS);
      jest.advanceTimersByTime(250);
      expect(signals[0]?.aborted).toBe(true);
      await expect(sending).resolves.toBe('retry');
    });

    test.each([
      ['an answer', () => recordingFetch(reply(202, ACCEPTED)).fetchFn],
      ['a failure', () => recordingFetch(() => Promise.reject(new Error('offline'))).fetchFn],
    ])('leaves no timer behind after %s', async (_name, make) => {
      jest.useFakeTimers();
      await createHttpTransport(ENDPOINT, { fetch: make() }).send(ROWS);
      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
