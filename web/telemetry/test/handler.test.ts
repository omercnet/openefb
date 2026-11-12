import { describe, expect, it } from "vitest";
import { MAX_BODY_BYTES, handleFetch, type DataPoint, type Env } from "../src/handler.js";

const UUID = "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

/** A counter row the way the app sends it; `over` replaces or adds fields. */
const row = (over: Record<string, unknown> = {}) => ({
  event: "Recording.started",
  app: "1.2.0",
  platform: "ios",
  update: "embedded",
  region: "us",
  count: 2,
  ...over,
});

function sink() {
  const points: DataPoint[] = [];
  const env: Env = { COUNTERS: { writeDataPoint: (point) => void points.push(point) } };
  return { env, points };
}

const request = (body: BodyInit | null, init: RequestInit = {}, path = "/v1/counters") =>
  new Request(`https://telemetry.example${path}`, { method: "POST", body, ...init });
const post = (env: Env, body: unknown, path?: string) =>
  handleFetch(request(typeof body === "string" ? body : JSON.stringify(body), {}, path), env);
const batch = (...counters: unknown[]) => ({ v: 1, counters });

describe("POST /v1/counters: what is stored", () => {
  it("writes one data point per row: event first, then the dimensions, then the parameter values; the count is the value", async () => {
    const { env, points } = sink();
    const res = await post(env, batch(row()));

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 1, dropped: 0 });
    expect(points).toEqual([
      {
        indexes: ["Recording.started"],
        blobs: ["Recording.started", "1.2.0", "ios", "embedded", "us", "", ""],
        doubles: [2],
      },
    ]);
  });

  it("puts parameter values after the dimensions, in the order the schema declares them", async () => {
    const { env, points } = sink();
    await post(
      env,
      batch(
        row({ event: "Navigation.screen", params: { screen: "map" }, count: 5 }),
        row({ event: "Recording.stopped", params: { durationMinutes: "15-60" } }),
        // sent in the opposite order to the schema's product, edition
        row({ event: "ChartPack.installed", params: { edition: "2026-08b", product: "il-diagrams" } }),
        row({ event: "Israel.fplShared", params: { method: "email" } }),
      ),
    );

    expect(points.map((p) => p.blobs.slice(5))).toEqual([
      ["map", ""],
      ["15-60", ""],
      ["il-diagrams", "2026-08b"],
      ["email", ""],
    ]);
    expect(points[0]?.doubles).toEqual([5]);
  });

  it("accepts an update id that is a UUID, and an app version of up to three digits per part", async () => {
    const { env, points } = sink();
    await post(env, batch(row({ update: UUID, app: "123.45.6" })));
    expect(points[0]?.blobs.slice(1, 5)).toEqual(["123.45.6", "ios", UUID, "us"]);
  });

  it.each([
    ["ios", "us"],
    ["android", "israel"],
  ])("accepts platform %s and region %s", async (platform, region) => {
    const { env, points } = sink();
    await post(env, batch(row({ platform, region })));
    expect(points).toHaveLength(1);
  });

  it("accepts empty parameters on an event that has none", async () => {
    const { env, points } = sink();
    await post(env, batch(row({ params: {} })));
    expect(points).toHaveLength(1);
  });

  it("keeps rows in the order they were sent and writes duplicates as they are", async () => {
    const { env, points } = sink();
    await post(env, batch(row({ count: 1 }), row({ event: "Debrief.generated", count: 7 }), row({ count: 3 })));
    expect(points.map((p) => [p.blobs[0], p.doubles[0]])).toEqual([
      ["Recording.started", 1],
      ["Debrief.generated", 7],
      ["Recording.started", 3],
    ]);
  });

  it("accepts the largest batch and the largest count", async () => {
    const { env, points } = sink();
    const res = await post(env, batch(...Array.from({ length: 40 }, () => row({ count: 100000 }))));
    expect(res.status).toBe(202);
    expect(points).toHaveLength(40);
    expect(points[0]?.doubles).toEqual([100000]);
  });
});

describe("POST /v1/counters: rows that are not stored", () => {
  it.each([
    ["an event that is not in the schema", row({ event: "Flight.route" })],
    ["a lower-case event name", row({ event: "recording.started" })],
    ["a parameter missing", row({ event: "Navigation.screen" })],
    ["a parameter the event does not have", row({ params: { airport: "LLBG" } })],
    ["an extra parameter on an event that has one", row({ event: "Navigation.screen", params: { screen: "map", airport: "LLBG" } })],
    ["a parameter value outside the allowed values", row({ event: "Navigation.screen", params: { screen: "settings" } })],
    ["a parameter value in the wrong case", row({ event: "Navigation.screen", params: { screen: "Map" } })],
    ["a parameter that is not text", row({ event: "Navigation.screen", params: { screen: 1 } })],
    ["parameters that are not an object", row({ event: "Navigation.screen", params: ["map"] })],
    ["parameters on an event that has none", row({ params: { screen: "map" } })],
    ["parameters that are null", row({ params: null })],
    ["parameters that are a number", row({ params: 5 })],
    ["parameters that are text", row({ params: "screen" })],
    ["parameters that are true", row({ params: true })],
    ["a pack name that is a list holding a valid name", row({ event: "ChartPack.installed", params: { product: ["il-diagrams"], edition: "2026" } })],
    ["an app version that is a list holding a valid version", row({ app: ["1.2.0"] })],
    ["an update id that is a list holding a valid id", row({ update: ["embedded"] })],
    ["a platform that is a list holding a valid platform", row({ platform: ["ios"] })],
    ["an event that is a number", row({ event: 5 })],
    ["a pack name with capitals", row({ event: "ChartPack.installed", params: { product: "IL-DIAGRAMS", edition: "2026" } })],
    ["a pack name with a space", row({ event: "ChartPack.installed", params: { product: "il diagrams", edition: "2026" } })],
    ["a pack name that is too long", row({ event: "ChartPack.installed", params: { product: "a".repeat(33), edition: "2026" } })],
    ["a pack name that is an e-mail address", row({ event: "ChartPack.installed", params: { product: "pilot@example.com", edition: "2026" } })],
    ["an extra field (a device name)", row({ device: "iPad13,4" })],
    ["an extra field (a time stamp)", row({ at: 1700000000000 })],
    ["a missing app version", row({ app: undefined })],
    ["an app version that is not three numbers", row({ app: "1.2" })],
    ["an app version with a build suffix", row({ app: "1.2.0-beta.3" })],
    ["an unknown platform", row({ platform: "web" })],
    ["a platform in the wrong case", row({ platform: "iOS" })],
    ["an unknown region", row({ region: "eu" })],
    ["an update id that is neither embedded nor a UUID", row({ update: "abc123" })],
    ["an update id with capitals", row({ update: UUID.toUpperCase() })],
    ["a count of 0", row({ count: 0 })],
    ["a negative count", row({ count: -1 })],
    ["a fractional count", row({ count: 1.5 })],
    ["a count above the maximum", row({ count: 100001 })],
    ["a count that is text", row({ count: "2" })],
    ["a missing count", row({ count: undefined })],
    ["a row that is null", null],
    ["a row that is a string", "Recording.started"],
    ["a row that is a list", [row()]],
  ])("drops %s and stores nothing for it", async (_name, bad) => {
    const { env, points } = sink();
    const res = await post(env, batch(bad));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 0, dropped: 1 });
    expect(points).toEqual([]);
  });

  it("stores the good rows of a batch that also has bad ones, and says how many of each", async () => {
    const { env, points } = sink();
    const res = await post(env, batch(row({ count: 1 }), row({ event: "Nope" }), row({ count: 2 }), row({ region: "x" })));
    expect(await res.json()).toEqual({ accepted: 2, dropped: 2 });
    expect(points.map((p) => p.doubles[0])).toEqual([1, 2]);
  });
});

describe("POST /v1/counters: a batch that is not valid", () => {
  it.each([
    ["not JSON", "not json"],
    ["empty", ""],
    ["JSON text that is a number", "5"],
    ["JSON that is a list", "[]"],
    ["JSON null", "null"],
    ["without a version", { counters: [row()] }],
    ["with another version", { v: 2, counters: [row()] }],
    ["with the version as text", { v: "1", counters: [row()] }],
    ["without counters", { v: 1 }],
    ["with counters that are not a list", { v: 1, counters: row() }],
    ["with no counters", { v: 1, counters: [] }],
    ["with more than 40 rows", { v: 1, counters: Array.from({ length: 41 }, () => row()) }],
    ["with an extra top-level field", { v: 1, counters: [row()], sessionId: "abc" }],
  ])("is refused with 400 when %s, and nothing is stored", async (_name, body) => {
    const { env, points } = sink();
    const res = await post(env, body);
    expect(res.status).toBe(400);
    expect(points).toEqual([]);
  });
});

describe("POST /v1/counters: no body", () => {
  it("is a refused batch (400), not a crash or a size error, when the request has no body at all", async () => {
    const { env, points } = sink();
    const res = await handleFetch(new Request("https://telemetry.example/v1/counters", { method: "POST" }), env);
    expect(res.status).toBe(400);
    expect(points).toEqual([]);
  });
});

describe("POST /v1/counters: size", () => {
  const encoder = new TextEncoder();

  it("refuses a body over the limit with 413, without storing anything", async () => {
    const { env, points } = sink();
    const big = JSON.stringify(batch(row())) + " ".repeat(MAX_BODY_BYTES);
    const res = await handleFetch(request(big), env);
    expect(res.status).toBe(413);
    expect(points).toEqual([]);
  });

  it("accepts a body of exactly the limit", async () => {
    const { env, points } = sink();
    const text = JSON.stringify(batch(row()));
    const padded = text + " ".repeat(MAX_BODY_BYTES - encoder.encode(text).length);
    expect(encoder.encode(padded).length).toBe(MAX_BODY_BYTES);
    const res = await handleFetch(request(padded), env);
    expect(res.status).toBe(202);
    expect(points).toHaveLength(1);
  });

  it("stops reading a stream as soon as it passes the limit", async () => {
    const { env } = sink();
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(4096).fill(32));
        if (pulls > 1000) controller.close();
      },
    });
    const res = await handleFetch(request(stream, { duplex: "half" } as RequestInit), env);
    expect(res.status).toBe(413);
    expect(pulls).toBeLessThan(10);
  });
});

describe("routing", () => {
  it("answers GET /health", async () => {
    const res = await handleFetch(new Request("https://telemetry.example/health"), {});
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it.each(["GET", "PUT", "DELETE", "PATCH"])("refuses %s on the counters path with 405", async (method) => {
    const { env, points } = sink();
    const res = await handleFetch(new Request("https://telemetry.example/v1/counters", { method }), env);
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(points).toEqual([]);
  });

  it.each(["/", "/v1", "/v1/counters/", "/v2/counters", "/counters", "/notams.json"])("has nothing at %s", async (path) => {
    const { env } = sink();
    const res = await post(env, batch(row()), path);
    expect(res.status).toBe(404);
  });
});

describe("when counting is not configured or fails", () => {
  it("does nothing and says so while the Analytics Engine binding is missing (the Worker is inert until the owner binds it)", async () => {
    const res = await post({}, batch(row()));
    expect(res.status).toBe(503);
  });

  it("refuses before it looks at the batch: a Worker without the binding is not one that quietly drops everything", async () => {
    const res = await post({}, batch({ event: "Nope" }));
    expect(res.status).toBe(503);
  });

  it("answers 503 when the dataset refuses a write, and stops at the first refusal", async () => {
    let calls = 0;
    const env: Env = {
      COUNTERS: {
        writeDataPoint: () => {
          calls += 1;
          throw new Error("quota exceeded");
        },
      },
    };
    const res = await post(env, batch(row(), row(), row()));
    expect(res.status).toBe(503);
    expect(calls).toBe(1);
  });
});

describe("what the Worker never looks at or gives back", () => {
  /** A request whose headers and Cloudflare properties blow up when read: the handler must not touch them. */
  function untouchable(body: string): Request {
    const guarded = {
      url: "https://telemetry.example/v1/counters",
      method: "POST",
      body: new Request("https://x.example", { method: "POST", body }).body,
      get headers(): never {
        throw new Error("the handler read a request header");
      },
      get cf(): never {
        throw new Error("the handler read request.cf");
      },
    };
    return guarded as unknown as Request;
  }

  it("reads no request header and no Cloudflare property (so no address, agent or location can be stored)", async () => {
    const { env, points } = sink();
    const res = await handleFetch(untouchable(JSON.stringify(batch(row()))), env);
    expect(res.status).toBe(202);
    expect(points).toHaveLength(1);
  });

  it("stores nothing but the schema fields, whatever the request carries", async () => {
    const { env, points } = sink();
    await handleFetch(
      request(JSON.stringify(batch(row())), {
        headers: { "user-agent": "Kanaf/1.2 iPad13,4", cookie: "id=42", "cf-connecting-ip": "203.0.113.9", authorization: "Bearer x" },
      }),
      env,
    );
    expect(JSON.stringify(points)).not.toMatch(/Kanaf\/1|iPad|203\.0|id=42|Bearer/);
    expect(points[0]?.blobs).toHaveLength(7);
  });

  it("sets no cookie and allows no caching, on every kind of answer", async () => {
    const { env } = sink();
    const answers = await Promise.all([
      post(env, batch(row())),
      post(env, "bad"),
      post({}, batch(row())),
      handleFetch(new Request("https://telemetry.example/v1/counters"), env),
      post(env, batch(row()), "/nope"),
      handleFetch(request(" ".repeat(MAX_BODY_BYTES + 1)), env),
      handleFetch(new Request("https://telemetry.example/health"), env),
    ]);
    for (const res of answers) {
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("answers with counts only: nothing from the request is echoed back", async () => {
    const { env } = sink();
    const res = await post(env, batch(row({ update: UUID }), row({ event: "Nope", app: "9.9.9" })));
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ accepted: 1, dropped: 1 });
    expect(text).not.toContain(UUID);
    expect(text).not.toContain("9.9.9");
  });
});
