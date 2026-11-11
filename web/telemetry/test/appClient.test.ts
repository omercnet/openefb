// Contract test between the two halves of the usage counters: the app's real client (the Telemetry facade and its HTTP transport,
// imported from app/src) talking to this Worker's real handler. If the app counts something the Worker would drop, if the
// transport misreads the Worker's answer, or if a full batch outgrows the Worker's body limit, this fails here, in CI for the
// Worker, as the copy of the schema in app/ does in CI for the app.
import { describe, expect, it } from "vitest";
import {
  createHttpTransport,
  telemetryEndpoint,
} from "../../../app/src/adapters/telemetryTransport";
import { FakeTelemetryStorage } from "../../../app/src/domain/ports/telemetry";
import { TELEMETRY_SCHEMA } from "../../../app/src/domain/telemetry/schema";
import {
  Telemetry,
  type TelemetryContext,
} from "../../../app/src/domain/telemetry/telemetry";
import {
  MAX_BODY_BYTES,
  handleFetch,
  type DataPoint,
  type Env,
} from "../src/handler.js";
import schemaJson from "../src/schema.json";

const UUID = "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const ENDPOINT = telemetryEndpoint(
  "https://telemetry.example",
  false,
) as string;

/** The Worker behind a fetch: what the app's transport sees, with the answers it collects. */
function worker(env: Env) {
  const requests: { url: string; body: string }[] = [];
  const answers: { accepted: number; dropped: number }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    requests.push({ url, body: init.body as string });
    const response = await handleFetch(new Request(url, init), env);
    if (response.status === 202) answers.push(await response.clone().json());
    return response;
  }) as unknown as typeof fetch;
  return { fetchFn, requests, answers };
}

function sink() {
  const points: DataPoint[] = [];
  const env: Env = {
    COUNTERS: { writeDataPoint: (point) => void points.push(point) },
  };
  return { env, points };
}

function client(fetchFn: typeof fetch, context: () => TelemetryContext) {
  return new Telemetry({
    storage: new FakeTelemetryStorage(),
    transport: createHttpTransport(ENDPOINT, { fetch: fetchFn }),
    context,
  });
}

type Spec = { values?: readonly string[]; pattern?: string };
const PACK_NAMES = ["il-diagrams", "a", "a".repeat(32), "0x._-"];

/** Every way an event can be signalled: each value of each closed list, and a few pack names. */
function everySignal(): { event: string; params?: Record<string, string> }[] {
  const out: { event: string; params?: Record<string, string> }[] = [];
  for (const [event, params] of Object.entries(TELEMETRY_SCHEMA.events) as [
    string,
    Record<string, Spec>,
  ][]) {
    const names = Object.keys(params);
    if (names.length === 0) {
      out.push({ event });
      continue;
    }
    const choices = names.map((name) => params[name]?.values ?? PACK_NAMES);
    const longest = Math.max(...choices.map((list) => list.length));
    for (let i = 0; i < longest; i += 1) {
      out.push({
        event,
        params: Object.fromEntries(
          names.map((name, n) => [
            name,
            (choices[n] as readonly string[])[
              i % (choices[n] as readonly string[]).length
            ],
          ]),
        ),
      });
    }
  }
  return out;
}

describe("the app and the Worker agree", () => {
  it("on the schema: the app's table is the Worker's schema.json", () => {
    expect(TELEMETRY_SCHEMA).toEqual(schemaJson);
  });

  it("on the path: the endpoint the app builds is the one the Worker serves", () => {
    expect(new URL(ENDPOINT).pathname).toBe("/v1/counters");
  });

  it("on every event, parameter value, platform, region and kind of update: the Worker takes everything the app counts", async () => {
    const { env, points } = sink();
    const { fetchFn, answers } = worker(env);
    let counted = 0;
    for (const platform of TELEMETRY_SCHEMA.platforms) {
      for (const region of TELEMETRY_SCHEMA.regions) {
        for (const update of ["embedded", UUID]) {
          const telemetry = client(fetchFn, () => ({
            app: "12.34.567",
            platform,
            update,
            region,
          }));
          for (const { event, params } of everySignal()) {
            (
              telemetry.signal as (
                event: string,
                params?: Record<string, string>,
              ) => void
            )(event, params);
            counted += 1;
          }
          await telemetry.flush();
        }
      }
    }

    expect(counted).toBeGreaterThan(50);
    expect(answers.reduce((sum, answer) => sum + answer.dropped, 0)).toBe(0);
    expect(answers.reduce((sum, answer) => sum + answer.accepted, 0)).toBe(
      counted,
    );
    expect(points).toHaveLength(counted);
  });

  it("on the size: a full batch of the longest rows fits the Worker's body limit and is taken whole", async () => {
    const { env, points } = sink();
    const { fetchFn, requests, answers } = worker(env);
    let app = 0;
    const telemetry = client(fetchFn, () => ({
      app: `999.999.${999 - app}`,
      platform: "android",
      update: UUID,
      region: "israel",
    }));
    for (app = 0; app < TELEMETRY_SCHEMA.maxRows; app += 1) {
      telemetry.signal("ChartPack.installed", {
        product: "a".repeat(32),
        edition: "b".repeat(32),
      });
    }
    await telemetry.flush();

    expect(requests).toHaveLength(1);
    expect(new TextEncoder().encode(requests[0]?.body).length).toBeLessThan(
      MAX_BODY_BYTES,
    );
    expect(answers).toEqual([
      { accepted: TELEMETRY_SCHEMA.maxRows, dropped: 0 },
    ]);
    expect(points).toHaveLength(TELEMETRY_SCHEMA.maxRows);
  });

  it("on what 202 means: the counts are taken, so a second flush has nothing to send", async () => {
    const { env } = sink();
    const { fetchFn, requests } = worker(env);
    const telemetry = client(fetchFn, () => ({
      app: "1.2.0",
      platform: "ios",
      update: "embedded",
      region: "us",
    }));
    telemetry.signal("Recording.started");
    await telemetry.flush();
    await telemetry.flush();
    expect(requests).toHaveLength(1);
  });

  it("on what 503 means: a Worker with no dataset bound stores nothing, and the app keeps the counts until it has one", async () => {
    const env: Env = {};
    const { fetchFn, requests } = worker(env);
    const telemetry = client(fetchFn, () => ({
      app: "1.2.0",
      platform: "ios",
      update: "embedded",
      region: "us",
    }));
    telemetry.signal("Recording.started");
    telemetry.signal("Recording.started");
    await telemetry.flush();
    expect(requests).toHaveLength(1);

    const { env: bound, points } = sink();
    env.COUNTERS = bound.COUNTERS;
    await telemetry.flush();
    expect(requests).toHaveLength(2);
    expect(requests[1]?.body).toBe(requests[0]?.body);
    expect(points).toEqual([
      {
        indexes: ["Recording.started"],
        blobs: ["Recording.started", "1.2.0", "ios", "embedded", "us", "", ""],
        doubles: [2],
      },
    ]);
  });
});
