#!/usr/bin/env node
// Port inventory for the React Native rewrite (ticket P0).
// Usage: node tools/port/inventory.mjs [--out app/docs/port-map.md] [--check]
// Scans efb-212/**/*.swift and efb-212Tests/**/*.swift, classifies each file, maps it to a
// Phase 1 track/ticket, links tests by type-name references, and writes a deterministic
// markdown port map. No dependencies; output is sorted and contains no timestamps.
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'app/docs/port-map.md';
const CHECK = args.includes('--check');

const UI_FW = new Set(['SwiftUI', 'UIKit', 'MapLibre', 'PDFKit']);
// Frameworks with a pure-Swift or trivially replaceable surface; everything else is Apple-specific.
// This set reproduces the cross-platform.md count (43 files); CoreLocation and CryptoKit are NOT in it.
const PORTABLE_FW = new Set(['Foundation', 'GRDB', 'os', 'OSLog', 'Observation', 'Combine', 'SQLite3', 'CoreGraphics', 'ImageIO']);
const TEST_FW = new Set(['Testing', 'XCTest']);
// CoreLocation is mostly coordinate types and CryptoKit is hashing: files whose only non-portable
// imports are these become pure logic after a coordinate type / expo-crypto swap ("thin" adapters).
const COORD_ONLY = new Set(['CoreLocation', '_LocationEssentials', 'CryptoKit']);

const walk = (dir) =>
  readdirSync(dir).sort().flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.swift') ? [p] : [];
  });
const rel = (p) => relative(ROOT, p).split('\\').join('/');
const lines = (s) => (s.length === 0 ? 0 : s.split('\n').length - (s.endsWith('\n') ? 1 : 0));

// ---- track rules: first match wins. [regex on path under efb-212/, track, ticket, note] ----
const RULES = [
  [/^Data\/RecordingDatabase/, 'D', 'D4'],
  [/^Data\/(AviationDatabase|IsraelAviation)/, 'D', 'D5'],
  [/^Data\//, 'D', 'D2'],
  [/^Core\/DesignTokens|^Core\/(DisplayMode|Interaction)\./, 'U', 'U1'],
  [/^Core\/Disclaimers/, 'U', 'U7'],
  [/^Core\/(DataRefreshScheduler|RemoteConfig)/, 'S', 'S1'],
  [/^Core\/ActiveRoute/, 'L', 'L2'],
  [/^Core\/(AppState|Protocols)|^Core\/Extensions\/AppState/, null, null, 'app state/navigation/DI spine: Phase 0 (F), not a Phase 1 track'],
  [/^Core\//, 'L', 'L1'],
  [/^Services\/Debrief\/DebriefEngine/, 'A', 'A6'],
  [/^Services\/Debrief\//, 'L', 'L5'],
  [/^Services\/Prediction\//, 'L', 'L7'],
  [/^Services\/Replay\//, 'L', 'L8'],
  [/^Services\/Simulation\//, null, null, 'scenario sims (plan 5.3), no Phase 1 ticket'],
  [/^Services\/Recording\/AudioRecorder/, 'A', 'A2'],
  [/^Services\/Recording\/(TranscriptionService|AviationVocabulary)/, 'A', 'A3'],
  [/^Services\/Recording\/TrackRecorder/, 'A', 'A1'],
  [/^Services\/Recording\//, 'L', 'L4'],
  [/^Services\/(LocationService|GPSStatus)/, 'A', 'A1'],
  [/^Services\/KeychainStore/, 'A', 'A4'],
  [/^Services\/TelemetryService/, 'A', 'A5'],
  [/^Services\/CurrencyService/, 'L', 'L6'],
  [/^Services\/AirportDiagram/, 'M', 'M4'],
  [/^Services\/OfflineMapService/, 'M', 'M3'],
  [/^Services\/FollowModeState/, 'M', 'M2'],
  [/^Services\/Israel(Chart(Manifest|Service|Store)|Diagram(Pack|Store))/, 'S', 'S1'],
  [/^Services\/Israel(Chart|OfficialChartLayer|LSAOverlay|BriefingMapHighlight)/, 'M', 'M1'],
  [/^Services\/(MapService|MapQueryRegion)/, 'M', 'M1'],
  [/^Services\/Israel(AlertService|NotamService)/, 'S', 'S1'],
  [/^Services\/Israel/, 'L', 'L3'],
  [/^Services\/LandableAirportFilter/, 'L', 'L1'],
  [/^Services\//, 'S', 'S1'],
  [/^ViewModels\/MapViewModel/, 'M', 'M1'],
  [/^ViewModels\/(Recording|Replay)/, 'U', 'U8'],
  [/^ViewModels\/(AircraftProfile|PilotProfile|Logbook)/, 'U', 'U7'],
  [/^ViewModels\//, 'U', 'U4'],
  [/^Views\/Map\/(MapView|MapContainerView)/, 'M', 'M1'],
  [/^Views\/Map\/(ChartPDFView|AirportChartsSection)/, 'M', 'M4'],
  [/^Views\/Map\/DisplayModeModifier/, 'U', 'U1'],
  [/^Views\/Map\/RecordingOverlayView/, 'U', 'U8'],
  [/^Views\/Map\//, 'U', 'U4'],
  [/^Views\/Components\//, 'U', 'U1'],
  [/^Views\/Settings\/OfflineMapsView/, 'M', 'M3'],
  [/^Views\/(Aircraft|Onboarding|Logbook|Settings)\//, 'U', 'U7'],
  [/^Views\/Log\//, 'U', 'U3'],
  [/^Views\/Flights\//, 'U', 'U8'],
  [/^Views\/(Briefing|Planning)\//, 'U', 'U4'],
  [/^ContentView/, 'U', 'U5'],
  [/^efb_212App/, null, null, 'app entry point and composition root: Phase 0 (F)'],
];
const TICKET_TITLE = {
  D2: 'schema, migrations, repositories', D4: 'recording DB port', D5: 'aviation/Israel DB access',
  L1: 'geometry/region/units/metar/taf', L2: 'route planner, flight plan model', L3: 'Israel rules (route, LSA, closure, briefing, alerts)',
  L4: 'recording logic', L5: 'debrief', L6: 'currency + logbook rules', L7: 'prediction', L8: 'replay engine',
  M1: 'map surface and layers', M2: 'follow mode, ownship, camera', M3: 'offline packs', M4: 'airport diagram, PDF charts',
  A1: 'location adapter', A2: 'audio recorder adapter', A3: 'speech adapter + vocabulary', A4: 'secret store', A5: 'telemetry/crash', A6: 'AI debrief adapter',
  S1: 'data services, remote config, chart packs',
  U1: 'tokens, primitives, display mode', U3: 'flight log strip/columns', U4: 'search/nearest/weather/briefing/planning sheets', U5: 'app shell, iPhone layout',
  U7: 'settings, profiles, logbook, onboarding', U8: 'recording, replay, debrief UI',
};
const TRACKS = ['D', 'L', 'M', 'A', 'U', 'S'];
const TRACK_NAME = { D: 'Data', L: 'Domain logic', M: 'Map', A: 'Adapters', U: 'UI', S: 'Services glue' };

const layerOf = (p) => {
  const parts = p.split('/');
  if (parts.length === 1) return 'App';
  if (parts[0] === 'Views') return `Views/${parts[1]}`;
  if (parts[0] === 'Services' && parts.length > 2) return `Services/${parts[1]}`;
  return parts[0] === 'Data' && parts[1] === 'Models' ? 'Data/Models' : parts[0];
};

const importsOf = (src) => [...new Set([...src.matchAll(/^\s*(?:@\w+\s+)*import\s+(?:struct\s+|class\s+|enum\s+)?([A-Za-z_][\w]*)/gm)].map((m) => m[1]))].sort();
const bucketOf = (imps) => {
  if (imps.some((i) => UI_FW.has(i))) return 'UI';
  if (imps.some((i) => !PORTABLE_FW.has(i) && !TEST_FW.has(i))) return 'platform-adapter';
  return 'portable';
};
const typesOf = (src) => [...new Set([...src.matchAll(/^\s*(?:(?:@\w+(?:\([^)]*\))?|public|internal|private|fileprivate|final|open|nonisolated)\s+)*(?:class|struct|enum|actor|protocol|typealias)\s+([A-Z]\w*)/gm)].map((m) => m[1]))].sort();

// ---- load sources ----
const srcFiles = walk(join(ROOT, 'efb-212')).map((p) => {
  const text = readFileSync(p, 'utf8');
  const path = rel(p);
  const sub = path.slice('efb-212/'.length);
  const imports = importsOf(text);
  const rule = RULES.find((r) => r[0].test(sub));
  return {
    path, sub, lines: lines(text), imports, layer: layerOf(sub), types: typesOf(text), bucket: bucketOf(imports),
    thin: bucketOf(imports) === 'platform-adapter' && imports.every((i) => PORTABLE_FW.has(i) || COORD_ONLY.has(i)),
    track: rule ? rule[1] : null, ticket: rule ? rule[2] : null, note: rule?.[3] ?? 'no rule matched',
  };
});

// ---- tests ----
const DROP_WORDING = /(wording|label|caption|subtitle|headline|localiz|title|text|copy)/i; // ViewModelTests only
const DROP_APPLE = /(modelcontainer|observable|swiftdata)/i; // Apple framework behaviour, not ours
const testFiles = walk(join(ROOT, 'efb-212Tests')).map((p) => {
  const text = readFileSync(p, 'utf8');
  const path = rel(p);
  const cases = [];
  const ls = text.split('\n');
  let pending = null;
  ls.forEach((l, i) => {
    if (/^\s*@Test\b/.test(l)) pending = { line: i + 1, display: (l.match(/@Test\(\s*"([^"]*)"/) || [])[1] || '' };
    const f = l.match(/\bfunc\s+(\w+)/);
    if (f && pending) { cases.push({ ...pending, name: f[1] }); pending = null; }
    else if (f && /^\s*(?:override\s+)?func\s+test\w*\(/.test(l)) cases.push({ line: i + 1, display: '', name: f[1] });
  });
  const dir = path.split('/')[1] ?? '';
  return { path, text, lines: lines(text), imports: importsOf(text), cases, dir: path.split('/').length > 2 ? dir : '(root)' };
});
const idRe = (n) => new RegExp(`(?<![A-Za-z0-9_])${n}(?![A-Za-z0-9_])`);
const typeIndex = [];
for (const s of srcFiles) for (const t of s.types) if (t.length >= 5) typeIndex.push([t, s, idRe(t)]);
for (const t of testFiles) {
  const hit = new Set();
  for (const [name, s, re] of typeIndex) if (re.test(t.text)) hit.add(s);
  t.covers = [...hit].sort((a, b) => a.path.localeCompare(b.path));
}
for (const s of srcFiles) s.tests = testFiles.filter((t) => t.covers.includes(s)).map((t) => t.path);

// ---- test track + drop proposals ----
for (const t of testFiles) {
  const own = t.covers.filter((s) => s.track && s.bucket !== 'UI');
  const score = {};
  for (const s of own) score[s.track] = (score[s.track] || 0) + 1;
  const best = Object.entries(score).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  t.track = best ? best[0] : null;
  t.fileDrop = null;
  const base = t.path.split('/').pop();
  if (t.dir === 'Mocks') t.fileDrop = 'test double, replaced by a TS fake';
  else if (base === 'PrivacyManifestTests.swift') t.fileDrop = 'replaced by an app.config.ts privacy manifest assertion';
  else if (t.dir === 'Simulation') t.fileDrop = 'scenario harness, replaced by scenario sims (plan 5.3)';
  else if (t.covers.length > 0 && t.covers.every((s) => s.sub.startsWith('Views/'))) t.fileDrop = 'covers only SwiftUI view types under Views/';
  t.review = !t.fileDrop && t.covers.length === 0 && t.cases.length > 0;
  if (!t.track && !t.fileDrop) t.track = 'U';
  const split = (c) => `${c.name} ${c.display}`.replace(/([a-z])([A-Z])/g, '$1 $2');
  t.caseDrops = t.fileDrop ? [] : t.cases.map((c) => {
    if (t.dir === 'ViewModelTests' && DROP_WORDING.test(split(c))) return { ...c, why: 'asserts UI wording, not a domain decision' };
    if (t.dir !== 'CharacterizationTests' && DROP_APPLE.test(split(c))) return { ...c, why: 'tests Apple framework behaviour (SwiftData/Observation)' };
    return null;
  }).filter(Boolean);
};

// ---- render ----
const bucketNames = ['portable', 'platform-adapter', 'UI'];
const sum = (a, f) => a.reduce((n, x) => n + f(x), 0);
const esc = (s) => s.replace(/\|/g, '\\|');
const out = [];
const P = (s = '') => out.push(s);
const nCases = (ts) => sum(ts, (t) => t.cases.length);
const droppedCases = (t) => (t.fileDrop ? t.cases.length : t.caseDrops.length);
const keptCases = (t) => t.cases.length - droppedCases(t);

P('# Port map: Swift to TypeScript');
P();
P('Generated by `node tools/port/inventory.mjs`. Do not edit by hand; regenerate after any Swift change.');
P('Output is sorted and has no timestamps, so a diff means the inventory changed.');
P();
P('## Totals');
P();
P(`Source files: ${srcFiles.length} (${sum(srcFiles, (s) => s.lines)} lines). Test files: ${testFiles.length} (${sum(testFiles, (t) => t.lines)} lines, ${nCases(testFiles)} cases).`);
P();
P('### By bucket');
P();
P('| Bucket | Files | Lines | Meaning |');
P('|---|---|---|---|');
const meaning = {
  portable: 'imports only Foundation, GRDB, os, OSLog, Observation, Combine, SQLite3, CoreGraphics, ImageIO',
  'platform-adapter': 'imports any other Apple framework (CoreLocation, SwiftData, AVFoundation, Speech, Security, ...)',
  UI: 'imports SwiftUI, UIKit, MapLibre or PDFKit',
};
for (const b of bucketNames) {
  const f = srcFiles.filter((s) => s.bucket === b);
  P(`| ${b} | ${f.length} | ${sum(f, (s) => s.lines)} | ${meaning[b]} |`);
}
P();
P('### Re-verification of cross-platform.md (43 / 60 / 74 files)');
P();
const doc = { portable: [43, 7123], 'platform-adapter': [60, 13604], UI: [74, 20067] };
P('| Bucket | Doc files | Script files | Diff | Doc lines | Script lines | Diff |');
P('|---|---|---|---|---|---|---|');
for (const b of bucketNames) {
  const f = srcFiles.filter((s) => s.bucket === b);
  const l = sum(f, (s) => s.lines);
  P(`| ${b} | ${doc[b][0]} | ${f.length} | ${f.length - doc[b][0]} | ${doc[b][1]} | ${l} | ${l - doc[b][1]} |`);
}
const viewsN = srcFiles.filter((s) => s.sub.startsWith('Views/')).length;
const viewsL = sum(srcFiles.filter((s) => s.sub.startsWith('Views/')), (s) => s.lines);
const uiOutside = srcFiles.filter((s) => s.bucket === 'UI' && !s.sub.startsWith('Views/'));
P();
P(`Views/ holds ${viewsN} files (${viewsL} lines). UI-bucket files outside Views/: ${uiOutside.length} (${sum(uiOutside, (s) => s.lines)} lines): ${uiOutside.map((s) => s.sub).join(', ') || 'none'}.`);
const viewsNonUi = srcFiles.filter((s) => s.sub.startsWith('Views/') && s.bucket !== 'UI');
if (viewsNonUi.length) P(`Views/ files not classified UI by imports: ${viewsNonUi.map((s) => s.sub).join(', ')}.`);
P(`The plan (5.1) cites 175 source files; the tree holds ${srcFiles.length} Swift files under efb-212/. The doc total 43+60+74 = 177.`);
const thinF = srcFiles.filter((s) => s.thin);
P(`Bucket rule: UI if it imports SwiftUI/UIKit/MapLibre/PDFKit; else portable if every import is in {Foundation, GRDB, os, OSLog, Observation, Combine, SQLite3, CoreGraphics, ImageIO}; else platform-adapter. cross-platform.md says "Foundation and GRDB only", but that wording does not reproduce 43 (Foundation+GRDB alone gives 30; adding os/OSLog gives 36). The set above, with CryptoKit left out, reproduces the file counts exactly. UI lines differ from the doc by 1.`);
P();
P(`Of the ${srcFiles.filter((s) => s.bucket === 'platform-adapter').length} platform-adapter files, ${thinF.length} (${sum(thinF, (s) => s.lines)} lines) are "thin": their only non-portable imports are CoreLocation (coordinate types) or CryptoKit. They port as pure logic once a portable coordinate type exists, so the real adapter surface is ${srcFiles.filter((s) => s.bucket === 'platform-adapter').length - thinF.length} files.`);
P();
P('### By track');
P();
P('| Track | Name | Source files | Lines | portable | platform-adapter | UI | Tests (files) | Test cases | Cases kept | Cases dropped |');
P('|---|---|---|---|---|---|---|---|---|---|---|');
const trackRow = (label, name, f, ts) =>
  P(`| ${label} | ${name} | ${f.length} | ${sum(f, (s) => s.lines)} | ${bucketNames.map((b) => f.filter((s) => s.bucket === b).length).join(' | ')} | ${ts.length} | ${nCases(ts)} | ${sum(ts, keptCases)} | ${sum(ts, droppedCases)} |`);
for (const tr of TRACKS) trackRow(tr, TRACK_NAME[tr], srcFiles.filter((s) => s.track === tr), testFiles.filter((t) => t.track === tr));
trackRow('none', 'No Phase 1 track', srcFiles.filter((s) => !s.track), testFiles.filter((t) => !t.track));
P();
P('### By ticket');
P();
P('| Ticket | Scope | Source files | Lines | Covering test files (ported) | Their cases |');
P('|---|---|---|---|---|---|');
const tickets = [...new Set(srcFiles.map((s) => s.ticket).filter(Boolean))].sort((a, b) => a[0].localeCompare(b[0]) || Number(a.slice(1)) - Number(b.slice(1)));
for (const k of tickets) {
  const f = srcFiles.filter((s) => s.ticket === k);
  const tcs = new Set(f.flatMap((s) => s.tests));
  const mine = testFiles.filter((t) => tcs.has(t.path) && !t.fileDrop);
  P(`| ${k} | ${TICKET_TITLE[k] ?? ''} | ${f.length} | ${sum(f, (s) => s.lines)} | ${mine.length} | ${sum(mine, keptCases)} |`);
}
P();
P('Per-ticket test counts overlap: a test file covering several tickets is counted under each. Per-track counts above assign each test file to exactly one track, so they sum to the total.');
P();
P('### Tests by directory');
P();
P('| Directory | Files | Cases | Kept | Dropped |');
P('|---|---|---|---|---|');
for (const dn of [...new Set(testFiles.map((t) => t.dir))].sort()) {
  const ts = testFiles.filter((t) => t.dir === dn);
  P(`| ${dn} | ${ts.length} | ${nCases(ts)} | ${sum(ts, keptCases)} | ${sum(ts, droppedCases)} |`);
}
const kept = sum(testFiles, keptCases);
P();
P(`Cases that become TypeScript characterisation tests: ${kept} of ${nCases(testFiles)} (plan 5.2 expects 700 to 900 of about 1,100; the automated drop rules are conservative and flag only whole-file and name-matched cases, so the real ratio needs a per-case review pass by each track owner). Cases counted: one per \`@Test\` or \`func test*\`; parameterised cases count once.`);

P();
P('## Files that fit no Phase 1 track');
P();
const none = srcFiles.filter((s) => !s.track);
if (none.length === 0) P('None.');
else {
  P('| File | Bucket | Lines | Reason |');
  P('|---|---|---|---|');
  for (const s of none) P(`| ${s.sub} | ${s.bucket} | ${s.lines} | ${s.note} |`);
}

P();
P('## Tests proposed for dropping');
P();
P('Whole files:');
P();
const fd = testFiles.filter((t) => t.fileDrop);
P('| Test file | Cases | Reason |');
P('|---|---|---|');
for (const t of fd) P(`| ${t.path.slice('efb-212Tests/'.length)} | ${t.cases.length} | ${t.fileDrop} |`);
P();
const rv = testFiles.filter((t) => t.review);
P('Review (no source type referenced, so no track could be proposed; kept until a human decides):');
P();
P('| Test file | Cases |');
P('|---|---|');
for (const t of rv) P(`| ${t.path.slice('efb-212Tests/'.length)} | ${t.cases.length} |`);
P();
P('Individual cases (selected by name; review before dropping):');
P();
const cd = testFiles.filter((t) => t.caseDrops.length);
if (!cd.length) P('None.');
else {
  P('| Test file:line | Case | Reason |');
  P('|---|---|---|');
  for (const t of cd) for (const c of t.caseDrops) P(`| ${t.path.slice('efb-212Tests/'.length)}:${c.line} | ${esc(c.display || c.name)} | ${c.why} |`);
}

P();
P('## Test cases per track (to be translated to TypeScript)');
P();
P('Files are assigned to the track with the most covered non-UI source files; ties go to the alphabetically first track. A "-" case count means the whole file is dropped above.');
for (const tr of [...TRACKS, null]) {
  const ts = testFiles.filter((t) => t.track === tr && !t.fileDrop);
  P();
  P(`### ${tr ? `${tr} ${TRACK_NAME[tr]}` : 'No track'} (${sum(ts, keptCases)} cases)`);
  P();
  if (!ts.length) { P('None.'); continue; }
  P('| Test file | Cases | Dropped | Covers |');
  P('|---|---|---|---|');
  for (const t of ts) P(`| ${t.path.slice('efb-212Tests/'.length)} | ${t.cases.length} | ${t.caseDrops.length} | ${t.covers.filter((s) => s.track === tr).slice(0, 4).map((s) => s.sub.split('/').pop().replace('.swift', '')).join(', ')} |`);
}

P();
P('## Source files');
P();
P('Columns: layer, bucket, lines, track/ticket, imports (CoreLocation marked "coord" when it is the only non-portable import), covering tests.');
P();
P('| File | Layer | Bucket | Lines | Track | Ticket | Imports | Tests |');
P('|---|---|---|---|---|---|---|---|');
for (const s of srcFiles) {
  const tn = s.tests.map((t) => t.split('/').pop().replace('.swift', ''));
  const tcell = tn.length > 3 ? `${tn.slice(0, 3).join(', ')} +${tn.length - 3}` : tn.join(', ');
  P(`| ${s.sub} | ${s.layer} | ${s.bucket} | ${s.lines} | ${s.track ?? '-'} | ${s.ticket ?? '-'} | ${s.imports.join(', ')} | ${tcell || '-'} |`);
}
P();
P('## Test files');
P();
P('| File | Cases | Lines | Track | Disposition | Imports |');
P('|---|---|---|---|---|---|');
for (const t of testFiles) P(`| ${t.path.slice('efb-212Tests/'.length)} | ${t.cases.length} | ${t.lines} | ${t.track ?? '-'} | ${t.fileDrop ? 'drop' : 'port'} | ${t.imports.filter((i) => !TEST_FW.has(i)).join(', ')} |`);
P();
P('## Swift behaviour differences found while porting');
P();
P('Record any Swift bug found during characterisation here (default: preserve Swift behaviour). None recorded yet.');
P();

const text = out.join('\n');
const target = resolve(ROOT, OUT);
if (CHECK) {
  const cur = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (cur !== text) { console.error(`${OUT} is stale; run node tools/port/inventory.mjs`); process.exit(1); }
} else {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}
console.log(`${srcFiles.length} source, ${testFiles.length} test files, ${nCases(testFiles)} cases, ${kept} kept`);
