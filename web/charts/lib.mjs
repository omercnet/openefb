// Pure helpers for publish.mjs (unit-tested in test/lib.test.mjs).

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Product and edition become path segments in a public bucket: no slashes, no "..". */
export function assertSegment(label, value) {
  if (typeof value !== "string" || !NAME.test(value) || value.includes("..")) {
    throw new Error(`${label} must match [A-Za-z0-9][A-Za-z0-9._-]* and not contain "..": ${JSON.stringify(value)}`);
  }
  return value;
}

export const objectKey = (product, edition, name) => `${assertSegment("product", product)}/${assertSegment("edition", edition)}/${assertSegment("file", name)}`;
export const productManifestKey = (product) => `${assertSegment("product", product)}/manifest.json`;

/**
 * Packs are served `immutable` for a year, so an edition's files must never change once uploaded. Re-publishing
 * the same edition is fine only when every file that already exists in the edition manifest has the same SHA-256.
 */
export function assertImmutable(existing, files) {
  for (const f of files) {
    const old = existing?.files?.find((e) => e.name === f.name);
    if (old && old.sha256 !== f.sha256) {
      throw new Error(`${f.name} already published in this edition with a different SHA-256 (${old.sha256.slice(0, 12)}... vs ${f.sha256.slice(0, 12)}...). Editions are immutable: publish a new edition id.`);
    }
  }
}

/** The app only serves editions whose validation passed; refuse to approve one that did not. */
export function assertApprovable(source, approve) {
  if (approve && source?.validation?.passed !== true) {
    throw new Error("--approve refused: the pipeline manifest has no validation.passed === true");
  }
}

/** Edition manifest = the pipeline's manifest.json plus what only the publisher knows. */
export function buildEditionManifest({ product, edition, source, files, existing, approve, now, baseUrl }) {
  const wasPublished = existing?.published === true;
  const published = approve || wasPublished;
  return {
    ...source,
    product,
    edition,
    published,
    publishedAt: published ? (wasPublished ? (existing.publishedAt ?? now) : now) : null,
    files: files.map((f) => ({
      name: f.name,
      bytes: f.bytes,
      sha256: f.sha256,
      path: `${product}/${edition}/${f.name}`,
      ...(baseUrl ? { url: `${baseUrl.replace(/\/+$/, "")}/${product}/${edition}/${f.name}` } : {}),
    })),
  };
}

/** Product index the app polls. `latest` is the newest PUBLISHED edition; unpublished ones are listed but never latest. */
export function mergeProductManifest(existing, edition, now) {
  const summary = {
    edition: edition.edition,
    published: edition.published,
    publishedAt: edition.publishedAt,
    validatedAt: edition.validated_at ?? edition.validatedAt ?? null,
    manifest: `${edition.product}/${edition.edition}/manifest.json`,
    files: edition.files,
  };
  const others = (existing?.editions ?? []).filter((e) => e.edition !== edition.edition);
  const editions = [...others, summary].sort((a, b) => (a.edition < b.edition ? 1 : a.edition > b.edition ? -1 : 0));
  const published = editions.filter((e) => e.published).sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  return { product: edition.product, updatedAt: now, latest: published[0]?.edition ?? null, editions };
}
