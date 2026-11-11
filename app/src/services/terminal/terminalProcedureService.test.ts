// Port of ServiceTests/TerminalProcedureServiceTests.swift (15 tests): the d-TPP metafile and cycle parsing, per-airport
// matching, categories, the cache and offline behaviour, and PDF download. Network and disk are fakes.
import { AppFailure } from '../../domain/errors';
import type { Airport } from '../../domain/core/models';
import { bytesOf, MemoryFileSystem, ScriptedDownloader, type ScriptedReply } from '../charts/testSupport';
import { fakeFetch, type FakeFetch, type StubReply } from '../testSupport';
import {
  categoryForChartCode,
  cycleContaining,
  cycleIsCurrent,
  cycleIsExpired,
  cycleWithCode,
  decodeIndex,
  encodeIndex,
  groupCharts,
  indexCharts,
  isCycleCode,
  makeTerminalChart,
  parseCycleInfo,
  parseMetafile,
  parseMetafileDate,
  terminalChartId,
  type TerminalChartCategory,
} from './dtpp';
import { TerminalProcedureService } from './terminalProcedureService';
import { decodeEntities, parseXml, XmlError } from './xml';

const utc = (iso: string) => Date.parse(iso);

const record = (seq: number, code: string, name: string, pdf: string, action = '') => `        <record>
          <chartseq>${seq}</chartseq>
          <chart_code>${code}</chart_code>
          <chart_name>${name}</chart_name>
          <useraction>${action}</useraction>
          <pdf_name>${pdf}</pdf_name>
          <cn_flg>N</cn_flg>
          <bvpage>227</bvpage>
          <procuid>11667</procuid>
          <civil>C</civil>
        </record>`;

const metafile = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<digital_tpp cycle="2611" from_edate="0901Z  10/29/26" to_edate="0901Z  11/26/26">
  <state_code ID="CA" state_fullname="CALIFORNIA">
    <city_name ID="PALO ALTO" volume="SW-2">
      <airport_name ID="PALO ALTO" military="N" apt_ident="PAO" icao_ident="KPAO" alnum="9216">
${record(10100, 'MIN', 'TAKEOFF MINIMUMS', 'SW2TO.PDF')}
${record(30000, 'STR', 'POINT REYES THREE', '00375POINTREYES.PDF')}
${record(53525, 'IAP', 'RNAV (GPS) RWY 31', '09216R31.PDF')}
${record(70000, 'APD', 'AIRPORT DIAGRAM', '09216AD.PDF')}
${record(90100, 'DP', 'CASEL SEVEN', 'DELETED_JOB.PDF', 'D')}
      </airport_name>
      <airport_name ID="SAN CARLOS" military="N" apt_ident="SQL" icao_ident="KSQL" alnum="9219">
${record(10100, 'MIN', 'TAKEOFF MINIMUMS', 'SW2TO.PDF')}
${record(10110, 'MIN', 'DIVERSE VECTOR AREA', 'SW2TO.PDF')}
${record(53525, 'IAP', 'RNAV (GPS) Y RWY 30', '09219RY30.PDF')}
${record(53525, 'IAP', 'RNAV (GPS) Z RWY 30', '09219RZ30.PDF')}
${record(70000, 'APD', 'AIRPORT DIAGRAM', '09219AD.PDF')}
${record(80000, 'HOT', 'HOT SPOT', '09219HS.PDF')}
${record(99999, 'IAP', 'NOT A PDF', '09219.XML')}
      </airport_name>
    </city_name>
  </state_code>
  <state_code ID="AL" state_fullname="ALABAMA">
    <city_name ID="ATMORE" volume="SE-4">
      <airport_name ID="ATMORE MUNI" military="N" apt_ident="0R1" icao_ident="" alnum="9420">
${record(53525, 'IAP', 'RNAV (GPS) RWY 18', '09420R18.PDF')}
      </airport_name>
    </city_name>
  </state_code>
</digital_tpp>`;

const infoJSON =
  '{"status":{"code":200,"message":"OK"},"edition":[{"geoname":"US","editionName":"CURRENT","format":"ZIP","editionDate":"10/29/2026","editionNumber":11}]}';

/** 2026-10-30, inside cycle 2611 (10/29 0901Z - 11/26 0901Z). */
const today = utc('2026-10-30T12:00:00Z');
const airport = (icao: string, faa?: string): Pick<Airport, 'icao' | 'faaID'> => ({ icao, faaID: faa ?? null });
const pdfBytes = bytesOf('%PDF-1.4\n%fake chart body\n');
const BASE = '/dtpp';

type Respond = (url: string) => ScriptedReply;

interface Rig {
  fs: MemoryFileSystem;
  urls: string[];
  respond: { current: Respond };
  fetchUrls: string[];
  info: { current: () => StubReply };
  service: (now?: number) => TerminalProcedureService;
}

function rig(initial: Respond, fs = new MemoryFileSystem()): Rig {
  const urls: string[] = [];
  const respond = { current: initial };
  const info = { current: (): StubReply => ({ body: infoJSON }) };
  const fetchUrls: string[] = [];
  const fetch: FakeFetch = fakeFetch((url) => {
    fetchUrls.push(url);
    return info.current();
  });
  const downloader = new ScriptedDownloader(fs, (req) => {
    urls.push(req.url);
    return respond.current(req.url);
  });
  return {
    fs,
    urls,
    respond,
    fetchUrls,
    info,
    service: (now = today) => new TerminalProcedureService({ fetch, downloader, fs, baseDir: BASE, now: () => now }),
  };
}

const faaResponder: Respond = (url) =>
  url.endsWith('d-tpp_Metafile.xml') ? { status: 200, body: bytesOf(metafile) } : { status: 404 };
const offline: Respond = () => {
  throw new Error('offline');
};

// MARK: Metafile parsing

test('parsesCycleAndValidityWindow', () => {
  const index = parseMetafile(metafile);
  expect(index.cycle.code).toBe('2611');
  expect(index.cycle.effectiveMs).toBe(utc('2026-10-29T09:01:00Z'));
  expect(index.cycle.expirationMs).toBe(utc('2026-11-26T09:01:00Z'));
  expect(cycleIsCurrent(index.cycle, today)).toBe(true);
  expect(cycleIsExpired(index.cycle, utc('2026-11-26T09:01:00Z'))).toBe(true);
  expect(cycleIsExpired(index.cycle, utc('2026-11-26T09:00:00Z'))).toBe(false);
});

test('keepsPerAirportRecordsAndSkipsDeletedAndNonPDF', () => {
  const index = parseMetafile(metafile);
  const pao = index.airports.KPAO;
  expect(pao.map((c) => c.name)).toEqual([
    'TAKEOFF MINIMUMS',
    'POINT REYES THREE',
    'RNAV (GPS) RWY 31',
    'AIRPORT DIAGRAM',
  ]);
  expect(pao.some((c) => c.pdfName === 'DELETED_JOB.PDF')).toBe(false);

  const sql = index.airports.KSQL;
  expect(sql).toHaveLength(6); // XML pdf skipped
  expect(sql.some((c) => c.pdfName.endsWith('.XML'))).toBe(false);
  expect(sql.every((c) => c.cycle === '2611')).toBe(true);
  // Shared PDF, distinct records: both kept with distinct ids.
  const minimums = sql.filter((c) => c.pdfName === 'SW2TO.PDF');
  expect(minimums).toHaveLength(2);
  expect(new Set(minimums.map(terminalChartId)).size).toBe(2);
});

test('rejectsMalformedXML', () => {
  expect(() => parseMetafile('<digital_tpp cycle="2611"><state_code>')).toThrow(AppFailure);
});

// MARK: Matching

test('matchesIcaoThenFallsBackToFaaIdent', () => {
  const index = parseMetafile(metafile);
  expect(indexCharts(index, 'KPAO', 'PAO')).toHaveLength(4);
  // Airport without an ICAO ident in the metafile is keyed by FAA ident.
  expect(indexCharts(index, '0R1', null).map((c) => c.pdfName)).toEqual(['09420R18.PDF']);
  expect(indexCharts(index, 'K0R1', '0R1').map((c) => c.pdfName)).toEqual(['09420R18.PDF']);
  // FAA ident also resolves an ICAO-keyed airport when the ICAO id is unknown to us.
  expect(indexCharts(index, 'XXXX', 'SQL')).toHaveLength(6);
  expect(indexCharts(index, 'KZZZ', 'ZZZ')).toEqual([]);
  // Case-insensitive.
  expect(indexCharts(index, 'kpao', null)).toHaveLength(4);
});

// MARK: Categories

test('mapsChartCodesToCategories', () => {
  const expected: [string, TerminalChartCategory][] = [
    ['APD', 'diagram'],
    ['IAP', 'approach'],
    ['DP', 'departure'],
    ['ODP', 'departure'],
    ['STR', 'arrival'],
    ['STAR', 'arrival'],
    ['MIN', 'minimums'],
    ['HOT', 'other'],
    ['LAH', 'other'],
    ['DAU', 'other'],
    ['', 'other'],
  ];
  for (const [code, category] of expected) expect(categoryForChartCode(code)).toBe(category);
});

test('groupsWithDiagramFirst', () => {
  const index = parseMetafile(metafile);
  const groups = groupCharts(indexCharts(index, 'KSQL', 'SQL'));
  expect(groups.map((g) => g.category)).toEqual(['diagram', 'approach', 'minimums', 'other']);
  expect(groups[1].charts.map((c) => c.name)).toEqual(['RNAV (GPS) Y RWY 30', 'RNAV (GPS) Z RWY 30']);
});

// MARK: Cycle computation

test('computesCycleCodesFromAiracSchedule', () => {
  const cases: [string, string, string][] = [
    ['2026-10-30T12:00:00Z', '2611', '2026-10-29T09:01:00Z'],
    ['2026-01-22T09:01:00Z', '2601', '2026-01-22T09:01:00Z'], // first cycle of 2026
    ['2026-01-22T09:00:59Z', '2513', '2025-12-25T09:01:00Z'], // last cycle of 2025
    ['2020-01-02T09:01:00Z', '2001', '2020-01-02T09:01:00Z'],
    ['2027-01-21T09:01:00Z', '2701', '2027-01-21T09:01:00Z'],
  ];
  for (const [iso, code, effective] of cases) {
    const cycle = cycleContaining(utc(iso));
    expect(cycle.code).toBe(code);
    expect(cycle.effectiveMs).toBe(utc(effective));
    expect(cycle.expirationMs).toBe(cycle.effectiveMs + 28 * 86_400_000);
  }
});

test('parsesFaaCycleInfoResponse', () => {
  const cycle = parseCycleInfo(infoJSON);
  expect(cycle.code).toBe('2611');
  expect(cycle.effectiveMs).toBe(utc('2026-10-29T09:01:00Z'));
  expect(() => parseCycleInfo('{"edition":[]}')).toThrow(AppFailure);
});

// MARK: Cache behaviour

test('usesPersistedIndexWithoutNetworkFetch', async () => {
  const seed = rig(faaResponder);
  const charts = await seed.service().charts(airport('KPAO', 'PAO'));
  expect(charts).toHaveLength(4);
  expect(seed.urls.some((u) => u.endsWith('/2611/xml_data/d-tpp_Metafile.xml'))).toBe(true);
  expect(seed.fs.exists(`${BASE}/2611/index.json`)).toBe(true);

  // A fresh service (new process) must serve from disk with zero requests.
  const second = rig(offline, seed.fs);
  const again = second.service();
  expect(await again.charts(airport('KSQL', 'SQL'))).toHaveLength(6);
  expect((await again.currentCycle()).code).toBe('2611');
  expect(second.urls).toEqual([]);
  expect(second.fetchUrls).toEqual([]);
});

test('servesExpiredCachedIndexWhenOffline', async () => {
  const seed = rig(faaResponder);
  await seed.service().charts(airport('KPAO'));

  const later = utc('2026-12-15T00:00:00Z'); // cycle 2611 expired
  const second = rig(offline, seed.fs);
  second.info.current = () => {
    throw new Error('offline');
  };
  const service = second.service(later);
  expect(await service.charts(airport('KPAO'))).toHaveLength(4);
  expect(cycleIsExpired(await service.currentCycle(), later)).toBe(true);
});

test('throwsWhenOfflineWithNoCache', async () => {
  const r = rig(offline);
  await expect(r.service().charts(airport('KPAO'))).rejects.toBeInstanceOf(AppFailure);
});

test('fallsBackToComputedCycleWhenInfoEndpointFails', async () => {
  const r = rig(faaResponder);
  r.info.current = () => ({ status: 503 });
  const charts = await r.service().charts(airport('KPAO'));
  expect(charts).toHaveLength(4);
  expect(r.urls).toContain('https://aeronav.faa.gov/d-tpp/2611/xml_data/d-tpp_Metafile.xml');
});

// MARK: PDF download

test('downloadsPdfOnceThenServesOffline_andPurgesOlderCycles', async () => {
  const r = rig(() => ({ status: 200, body: pdfBytes }));
  r.fs.put(`${BASE}/2610/09216AD.PDF`, pdfBytes);
  const service = r.service();
  const chart = makeTerminalChart('APD', 'AIRPORT DIAGRAM', '09216AD.PDF', '2611');

  const path = await service.pdfPath(chart);
  expect(path).toBe(`${BASE}/2611/09216AD.PDF`);
  expect(r.fs.files.get(path)).toEqual(pdfBytes);
  expect(r.urls).toEqual(['https://aeronav.faa.gov/d-tpp/2611/09216AD.PDF']);
  expect(r.fs.exists(`${BASE}/2610`)).toBe(false);

  r.respond.current = offline;
  expect(await service.pdfPath(chart)).toBe(path);
  expect(r.urls).toHaveLength(1);
});

test('rejectsNonPdfPayloadAndErrorStatus', async () => {
  const r = rig(() => ({ status: 200, body: bytesOf('<html>not found</html>') }));
  const service = r.service();
  const chart = makeTerminalChart('IAP', 'RNAV (GPS) RWY 31', '09216R31.PDF', '2611');
  await expect(service.pdfPath(chart)).rejects.toBeInstanceOf(AppFailure);

  r.respond.current = () => ({ status: 404, body: pdfBytes });
  await expect(service.pdfPath(chart)).rejects.toBeInstanceOf(AppFailure);

  expect(r.fs.exists(`${BASE}/2611/09216R31.PDF`)).toBe(false);
});

test('pdfNameCannotEscapeCycleFolder', async () => {
  const r = rig(() => ({ status: 200, body: pdfBytes }));
  const chart = makeTerminalChart('IAP', 'EVIL', '../../evil.PDF', '2611');
  const path = await r.service().pdfPath(chart);
  expect(path).toBe(`${BASE}/2611/evil.PDF`);
  expect(r.urls).toEqual(['https://aeronav.faa.gov/d-tpp/2611/evil.PDF']);
});

// JS-only guards (port notes S1c)

test('names and cycles that could escape the cache or the URL are refused before any request', async () => {
  const r = rig(() => ({ status: 200, body: pdfBytes }));
  const service = r.service();
  for (const [pdf, cycle] of [
    ['..\\..\\evil.PDF', '2611'],
    ['x.PDF?y=1', '2611'],
    ['good.PDF', '../x'],
    ['good.PDF', '26111'],
    ['', '2611'],
    ['notpdf.txt', '2611'],
  ]) {
    await expect(service.pdfPath(makeTerminalChart('IAP', 'n', pdf, cycle))).rejects.toBeInstanceOf(AppFailure);
  }
  expect(r.urls).toEqual([]);
});

test('a corrupt cached PDF is dropped and downloaded again; concurrent callers share one download', async () => {
  const r = rig(() => ({ status: 200, body: pdfBytes }));
  r.fs.put(`${BASE}/2611/09216AD.PDF`, bytesOf('not a pdf'));
  const service = r.service();
  const chart = makeTerminalChart('APD', 'AIRPORT DIAGRAM', '09216AD.PDF', '2611');
  const [a, b] = await Promise.all([service.pdfPath(chart), service.pdfPath(chart)]);
  expect(a).toBe(b);
  expect(r.urls).toHaveLength(1);
  expect(r.fs.files.get(a)).toEqual(pdfBytes);
  expect((await r.fs.list(BASE)).some((n) => n.startsWith('.download'))).toBe(false); // temp files are cleaned up
});

test('a failed index download is not cached: the next call tries again; concurrent callers share one load', async () => {
  const r = rig(offline);
  const service = r.service();
  await expect(service.charts(airport('KPAO'))).rejects.toBeInstanceOf(AppFailure);
  r.respond.current = faaResponder;
  const [a, b] = await Promise.all([service.charts(airport('KPAO')), service.charts(airport('KSQL'))]);
  expect([a.length, b.length]).toEqual([4, 6]);
  expect(r.urls.filter((u) => u.endsWith('Metafile.xml'))).toHaveLength(2); // one failed, one good
});

test('a failing disk write for the index is logged and the index is still served', async () => {
  const r = rig(faaResponder);
  r.fs.failWrites = true;
  expect(await r.service().charts(airport('KPAO'))).toHaveLength(4);
});

test('a saved index with the wrong shape is ignored and replaced from the network', async () => {
  const r = rig(faaResponder);
  r.fs.put(`${BASE}/2611/index.json`, bytesOf('{"cycle":1}'));
  expect(await r.service().charts(airport('KPAO'))).toHaveLength(4);
  expect(r.urls.some((u) => u.endsWith('Metafile.xml'))).toBe(true);
  expect(decodeIndex(encodeIndex(parseMetafile(metafile)))).toEqual(parseMetafile(metafile));
  expect(decodeIndex('[')).toBeNull();
});

test('metafile dates, cycle codes and unusual info responses', () => {
  expect(parseMetafileDate('0901Z  10/29/26')).toBe(utc('2026-10-29T09:01:00Z'));
  expect(parseMetafileDate('0901Z 13/29/26')).toBeNull();
  expect(parseMetafileDate('nonsense')).toBeNull();
  expect(isCycleCode('2611')).toBe(true);
  expect(isCycleCode('26111')).toBe(false);
  expect(cycleWithCode('2611', today)?.effectiveMs).toBe(utc('2026-10-29T09:01:00Z'));
  expect(cycleWithCode('9999', today)).toBeNull();
  const asString = parseCycleInfo(
    '{"edition":[{"editionName":"NEXT","editionDate":"11/26/2026","editionNumber":"12"},{"editionName":"current","editionDate":"10/29/2026","editionNumber":"11"}]}',
  );
  expect(asString.code).toBe('2611');
  for (const bad of [
    '{"edition":[{"editionDate":"10/29/2026","editionNumber":15}]}',
    '{"edition":[{"editionDate":"02/30/2026","editionNumber":3}]}',
    '{"edition":[{"editionDate":"10/29/2026"}]}',
    'x',
    '[]',
  ]) {
    expect(() => parseCycleInfo(bad)).toThrow(AppFailure);
  }
});

test('the metafile falls back to the computed cycle when the attributes are missing, and rejects a bad cycle', () => {
  const bare =
    '<digital_tpp><airport_name apt_ident="PAO" icao_ident="KPAO">' +
    record(1, 'APD', 'AD', 'A.PDF') +
    '</airport_name></digital_tpp>';
  const fallback = cycleContaining(today);
  expect(parseMetafile(bare, fallback).cycle).toEqual(fallback);
  expect(() => parseMetafile(bare)).toThrow(AppFailure);
  expect(() => parseMetafile('<digital_tpp cycle="26x1"></digital_tpp>', fallback)).toThrow(AppFailure);
  // Records outside any airport are dropped, not misattributed.
  const orphan = `<digital_tpp cycle="2611" from_edate="0901Z 10/29/26" to_edate="0901Z 11/26/26">${record(1, 'APD', 'AD', 'A.PDF')}</digital_tpp>`;
  expect(Object.keys(parseMetafile(orphan).airports)).toEqual([]);
});

test('the XML reader decodes entities and CDATA, skips comments, and rejects malformed documents', () => {
  const events: string[] = [];
  parseXml(
    '<?xml version="1.0"?><!DOCTYPE a><a x="1 &gt; 0" y=\'q\'><!-- c --><b>R&amp;D &#65;&#x42;<![CDATA[<raw>]]></b><c/></a>',
    {
      start: (n, a) =>
        events.push(
          `<${n}${Object.entries(a)
            .map(([k, v]) => ` ${k}=${v}`)
            .join('')}>`,
        ),
      text: (t) => events.push(`t:${t}`),
      end: (n) => events.push(`</${n}>`),
    },
  );
  expect(events).toEqual(['<a x=1 > 0 y=q>', '<b>', 't:R&D AB', 't:<raw>', '</b>', '<c>', '</c>', '</a>']);
  expect(decodeEntities('&bogus; &#0; &amp;')).toBe('&bogus; &#0; &');
  const noop = { start: () => undefined, text: () => undefined, end: () => undefined };
  for (const bad of [
    '',
    'plain text',
    '<a>',
    '<a></b>',
    '<a><b></a></b>',
    '<a/><b/>',
    '<a b></a>',
    '<a',
    '<!-- x',
    '<a>x</a>tail',
    'x<a/>',
  ]) {
    expect(() => parseXml(bad, noop)).toThrow(XmlError);
  }
});
