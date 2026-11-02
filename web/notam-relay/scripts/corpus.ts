/**
 * Local-only coverage report for the route-closure parser over an archive of real IAA NOTAMs.
 *
 *   npm run corpus -- /tmp/notams.json
 *
 * The archive is a JSON file `{ notams: [{ id, description, ... }] }` (or a bare array) where
 * `description` holds the E) text. It is NOT part of this repository: keep it outside the tree.
 * Pass `--misses` to print every route-closure NOTAM that yielded nothing, `--flagged` to print the
 * clauses emitted with `parsed: false`.
 */
import { readFileSync } from "node:fs";
import { looksLikeRouteClosure, parseClosures } from "../src/parse-notam.js";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: npm run corpus -- <notams.json> [--misses] [--flagged]");
  process.exit(2);
}
const showMisses = args.includes("--misses");
const showFlagged = args.includes("--flagged");

interface ArchiveNotam {
  id: string;
  description?: string;
  text?: string;
  raw?: string;
}
const parsed = JSON.parse(readFileSync(file, "utf8")) as { notams?: ArchiveNotam[] } | ArchiveNotam[];
const notams = Array.isArray(parsed) ? parsed : (parsed.notams ?? []);

const stats = {
  total: notams.length,
  routeClosure: 0,
  withClosures: 0,
  silentMisses: 0,
  clauses: 0,
  parsedClauses: 0,
  flaggedClauses: 0,
  partial: 0,
  withClosedAltitude: 0,
  withAvailable: 0,
  withExceptions: 0,
  multiKind: 0,
};
const misses: string[] = [];
const flagged: string[] = [];

for (const n of notams) {
  const e = n.description ?? n.text ?? n.raw ?? "";
  if (!looksLikeRouteClosure(e)) continue;
  stats.routeClosure++;
  const closures = parseClosures(n.id, e, null, null, null);
  if (closures.length === 0) {
    stats.silentMisses++;
    misses.push(`${n.id}: ${e.replace(/\s+/g, " ").slice(0, 200)}`);
    continue;
  }
  stats.withClosures++;
  for (const c of closures) {
    stats.clauses++;
    if (c.parsed) stats.parsedClauses++;
    else {
      stats.flaggedClauses++;
      flagged.push(`${n.id}: ${c.raw}`);
    }
    if (c.partial) stats.partial++;
    if (c.closedAltitudes.length > 0) stats.withClosedAltitude++;
    if (c.availableAltitudes.length > 0) stats.withAvailable++;
    if (c.exceptions.length > 0) stats.withExceptions++;
    if (c.routeKinds.length > 1) stats.multiKind++;
  }
}

console.log(JSON.stringify(stats, null, 2));
if (showMisses) for (const m of misses) console.log("MISS", m);
if (showFlagged) for (const f of flagged) console.log("FLAGGED", f);
