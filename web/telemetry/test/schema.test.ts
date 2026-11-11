import { describe, expect, it } from "vitest";
import raw from "../src/schema.json";
import { MAX_DATA_POINTS_PER_INVOCATION, compileSchema, schema, type SchemaJson } from "../src/schema.js";

/** A schema that is valid, to break one thing at a time. */
const base = (): SchemaJson => ({
  version: 1,
  maxRows: 10,
  maxCount: 1000,
  platforms: ["ios"],
  regions: ["us"],
  patterns: { app: "^\\d+\\.\\d+\\.\\d+$", update: "^embedded$" },
  events: { "A.b": {}, "C.d": { kind: { values: ["x", "y"] }, name: { pattern: "^[a-z]{1,4}$" } } },
});

describe("the shipped schema", () => {
  it("is the vocabulary the policy text documents: these events, nothing else", () => {
    expect(Object.keys(raw.events).sort()).toEqual(
      [
        "App.launched",
        "Debrief.generated",
        "ChartPack.installed",
        "FlightPlan.activated",
        "Israel.briefingOpened",
        "Israel.fplShared",
        "Navigation.screen",
        "Recording.started",
        "Recording.stopped",
      ].sort(),
    );
  });

  it("allows only these parameters, each with a closed set of values or a short lower-case pattern", () => {
    expect(raw.events).toEqual({
      "App.launched": {},
      "Debrief.generated": {},
      "ChartPack.installed": { product: { pattern: "^[a-z0-9][a-z0-9._-]{0,31}$" }, edition: { pattern: "^[a-z0-9][a-z0-9._-]{0,31}$" } },
      "FlightPlan.activated": {},
      "Israel.briefingOpened": {},
      "Israel.fplShared": { method: { values: ["share", "email"] } },
      "Navigation.screen": { screen: { values: ["map", "log"] } },
      "Recording.started": {},
      "Recording.stopped": { durationMinutes: { values: ["0-15", "15-60", "60+"] } },
    });
  });

  it("has the dimensions and limits the app and the Worker share", () => {
    expect(raw.version).toBe(1);
    expect(raw.platforms).toEqual(["ios", "android"]);
    expect(raw.regions).toEqual(["us", "israel"]);
    expect(raw.maxRows).toBe(40);
    expect(raw.maxCount).toBe(100000);
  });

  it("compiles", () => {
    expect(() => compileSchema(raw as SchemaJson)).not.toThrow();
    expect(schema.maxRows).toBe(40);
  });

  it("never needs more data points in one request than Analytics Engine allows", () => {
    expect(raw.maxRows).toBeLessThanOrEqual(MAX_DATA_POINTS_PER_INVOCATION);
    expect(MAX_DATA_POINTS_PER_INVOCATION).toBe(250);
  });
});

describe("compileSchema", () => {
  it("accepts a valid schema", () => {
    expect(() => compileSchema(base())).not.toThrow();
  });

  it.each([
    ["a version that is not 1", (s: SchemaJson) => void (s.version = 2)],
    ["a row limit of 0", (s: SchemaJson) => void (s.maxRows = 0)],
    ["a row limit above what one request may write", (s: SchemaJson) => void (s.maxRows = 251)],
    ["a fractional row limit", (s: SchemaJson) => void (s.maxRows = 2.5)],
    ["a count limit of 0", (s: SchemaJson) => void (s.maxCount = 0)],
    ["no platforms", (s: SchemaJson) => void (s.platforms = [])],
    ["a repeated platform", (s: SchemaJson) => void (s.platforms = ["ios", "ios"])],
    ["no regions", (s: SchemaJson) => void (s.regions = [])],
    ["an app pattern that is not a regular expression", (s: SchemaJson) => void (s.patterns.app = "(")],
    ["an app pattern that is not anchored", (s: SchemaJson) => void (s.patterns.app = "\\d+")],
    ["an update pattern that is not anchored", (s: SchemaJson) => void (s.patterns.update = "embedded")],
    ["no events", (s: SchemaJson) => void (s.events = {})],
    ["an event name that is not Group.name", (s: SchemaJson) => void (s.events["bad name"] = {})],
    ["an event with three parameters", (s: SchemaJson) => void (s.events["E.f"] = { a: { values: ["x"] }, b: { values: ["x"] }, c: { values: ["x"] } })],
    ["a parameter with neither values nor a pattern", (s: SchemaJson) => void (s.events["E.f"] = { a: {} })],
    ["a parameter with both values and a pattern", (s: SchemaJson) => void (s.events["E.f"] = { a: { values: ["x"], pattern: "^x$" } })],
    ["a parameter with an empty value list", (s: SchemaJson) => void (s.events["E.f"] = { a: { values: [] } })],
    ["a parameter with a repeated value", (s: SchemaJson) => void (s.events["E.f"] = { a: { values: ["x", "x"] } })],
    ["a parameter with a value that is not text", (s: SchemaJson) => void (s.events["E.f"] = { a: { values: [1 as unknown as string] } })],
    ["a parameter pattern that does not compile", (s: SchemaJson) => void (s.events["E.f"] = { a: { pattern: "^(" } })],
    ["a parameter pattern that is not anchored", (s: SchemaJson) => void (s.events["E.f"] = { a: { pattern: "[a-z]+" } })],
    ["a parameter name that is not lower camel case", (s: SchemaJson) => void (s.events["E.f"] = { Bad_Name: { values: ["x"] } })],
  ])("rejects %s", (_name, break_) => {
    const s = base();
    break_(s);
    expect(() => compileSchema(s)).toThrow();
  });
});

describe("a compiled schema", () => {
  const compiled = compileSchema(base());
  const good = { event: "C.d", params: { kind: "x", name: "ab" }, app: "1.0.0", platform: "ios", update: "embedded", region: "us", count: 3 };

  it("turns a row into a data point, parameter values in the order the schema declares them", () => {
    expect(compiled.toDataPoint(good)).toEqual({
      indexes: ["C.d"],
      blobs: ["C.d", "1.0.0", "ios", "embedded", "us", "x", "ab"],
      doubles: [3],
    });
  });

  it("exposes the row limit it was compiled with", () => {
    expect(compiled.maxRows).toBe(10);
  });

  it("pads missing parameter slots with empty text so every point has seven blobs", () => {
    expect(compiled.toDataPoint({ ...good, event: "A.b", params: undefined })?.blobs).toEqual(["A.b", "1.0.0", "ios", "embedded", "us", "", ""]);
  });

  it("returns null for a row that does not fit", () => {
    expect(compiled.toDataPoint({ ...good, platform: "android" })).toBeNull();
    expect(compiled.toDataPoint({ ...good, params: { kind: "z", name: "ab" } })).toBeNull();
    expect(compiled.toDataPoint({ ...good, count: 1001 })).toBeNull();
    expect(compiled.toDataPoint({ ...good, extra: 1 })).toBeNull();
  });

  it("does not treat inherited object properties as events or parameters", () => {
    expect(compiled.toDataPoint({ ...good, event: "constructor" })).toBeNull();
    expect(compiled.toDataPoint({ ...good, event: "toString" })).toBeNull();
    expect(compiled.toDataPoint({ ...good, params: { kind: "x", name: "ab", constructor: "x" } })).toBeNull();
    // A JSON body can carry a real own property named __proto__ (an object literal cannot).
    expect(compiled.toDataPoint({ ...good, event: "A.b", params: JSON.parse('{"__proto__":"x"}') })).toBeNull();
  });
});
