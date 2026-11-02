import assert from "node:assert/strict";
import { test } from "node:test";
import { assertApprovable, assertImmutable, assertSegment, buildEditionManifest, mergeProductManifest, objectKey } from "../lib.mjs";

const files = [{ name: "pack.mbtiles", bytes: 5, sha256: "ab" }];
const base = { product: "israel-cvfr", source: { validated_at: "2026-11-01" }, files, now: "2026-11-02T00:00:00Z" };

test("path segments reject traversal and slashes", () => {
  for (const bad of ["../x", "a/b", "", ".hidden", "a..b", "a b"]) assert.throws(() => assertSegment("edition", bad));
  assert.equal(objectKey("israel-cvfr", "2025-02", "pack.mbtiles"), "israel-cvfr/2025-02/pack.mbtiles");
});

test("an edition is unpublished until --approve, and re-publishing never unpublishes", () => {
  const draft = buildEditionManifest({ ...base, edition: "e1", approve: false, existing: null });
  assert.equal(draft.published, false);
  assert.equal(draft.publishedAt, null);
  const live = buildEditionManifest({ ...base, edition: "e1", approve: true, existing: draft });
  assert.equal(live.published, true);
  assert.equal(live.publishedAt, "2026-11-02T00:00:00Z");
  const again = buildEditionManifest({ ...base, edition: "e1", approve: false, existing: live, now: "2026-12-01T00:00:00Z" });
  assert.equal(again.published, true);
  assert.equal(again.publishedAt, "2026-11-02T00:00:00Z"); // original publish time kept
});

test("latest is the newest published edition; unpublished editions are listed but never latest", () => {
  const e1 = buildEditionManifest({ ...base, edition: "2025-02", approve: true, existing: null, now: "2026-01-01T00:00:00Z" });
  let idx = mergeProductManifest(null, e1, "2026-01-01T00:00:00Z");
  assert.equal(idx.latest, "2025-02");
  const e2 = buildEditionManifest({ ...base, edition: "2025-03", approve: false, existing: null });
  idx = mergeProductManifest(idx, e2, "2026-02-01T00:00:00Z");
  assert.equal(idx.latest, "2025-02");
  assert.deepEqual(idx.editions.map((e) => [e.edition, e.published]), [["2025-03", false], ["2025-02", true]]);
  const e2live = buildEditionManifest({ ...base, edition: "2025-03", approve: true, existing: e2, now: "2026-03-01T00:00:00Z" });
  idx = mergeProductManifest(idx, e2live, "2026-03-01T00:00:00Z");
  assert.equal(idx.latest, "2025-03");
  assert.equal(idx.editions.length, 2); // replaced, not duplicated
});

test("absolute urls only when a base url is given", () => {
  const withUrl = buildEditionManifest({ ...base, edition: "e1", approve: false, existing: null, baseUrl: "https://charts.example/" });
  assert.equal(withUrl.files[0].url, "https://charts.example/israel-cvfr/e1/pack.mbtiles");
  assert.equal(buildEditionManifest({ ...base, edition: "e1", approve: false, existing: null }).files[0].url, undefined);
});

test("a published edition's files are immutable: same hash passes, different hash is refused", () => {
  const existing = { files: [{ name: "pack.mbtiles", sha256: "ab" }] };
  assertImmutable(existing, [{ name: "pack.mbtiles", sha256: "ab" }]);
  assertImmutable(existing, [{ name: "other.mbtiles", sha256: "cd" }]);
  assertImmutable(null, files);
  assert.throws(() => assertImmutable(existing, [{ name: "pack.mbtiles", sha256: "cdcdcdcdcdcdcdcd" }]), /immutable/);
});

test("--approve needs a passing validation in the pipeline manifest", () => {
  assertApprovable({ validation: { passed: true } }, true);
  assertApprovable({}, false);
  assert.throws(() => assertApprovable({}, true), /validation/);
  assert.throws(() => assertApprovable({ validation: { passed: false } }, true), /validation/);
});
