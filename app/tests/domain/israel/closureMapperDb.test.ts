// Port of the three "NOTAM closures on the real network" cases of efb-212Tests/DataTests/IsraelAviationDatabaseTests.swift
// (deferred from D5 to the mapper port). Runs on the real bundled israel-aviation.sqlite.
import type { IsraelAviationDatabase } from '../../../src/data/aviation';
import { isFullyMapped, matchClosure } from '../../../src/domain/israel/closureMapper';
import type { IsraelRouteClosure } from '../../../src/domain/israel/notamTypes';
import { openBundledIsrael } from '../../data/aviation/israelBundled';

const closure = (chain: string[], id: string): IsraelRouteClosure => ({
  notamId: id,
  routeKind: 'CVFR',
  routeName: null,
  chain,
  validFrom: null,
  validTo: null,
  schedule: null,
});

describe('Israel Aviation Database Tests: NOTAM closures on the real network', () => {
  let db: IsraelAviationDatabase;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await openBundledIsrael());
  });
  afterAll(async () => close());

  // "E) CVFR RTE CLSD TAVOR-DESHE" is a live IAA NOTAM line in docs/research/israel-cvfr-samples/iaa-notam.txt.
  test('aRealClosureChainMapsToTheRealSegment', async () => {
    const match = await matchClosure(closure(['TAVOR', 'DESHE'], 'C2251/26'), db);
    expect(isFullyMapped(match)).toBe(true);
    const expected = await db.routeSegment('TAVOR', 'DESHE');
    expect(expected).not.toBeNull();
    expect(match.segments.map((s) => s.id)).toEqual([expected?.id]);
    expect(match.segments[0]?.nameEnglish).toBe('Kfar Tavor-Karey Deshe');
  });

  // Research example "CVFR RTE CLSD GALIM-DAROM-HOTRM-BOREN-FRDIS": the network stores every one of these legs in the
  // opposite direction, and a closure shuts the route both ways.
  test('aClosureChainStoredInTheOppositeDirectionStillMapsEveryLeg', async () => {
    const match = await matchClosure(closure(['GALIM', 'DAROM', 'HOTRM', 'BOREN', 'FRDIS'], 'C0001/26'), db);
    expect(isFullyMapped(match)).toBe(true);
    expect(match.segments).toHaveLength(4);
    expect(match.segments.map((s) => s.fromCode)).toEqual(['DAROM', 'HOTRM', 'BOREN', 'FRDIS']);
  });

  test('aClosureWithAnUnpublishedCodeReportsItInsteadOfDroppingIt', async () => {
    const match = await matchClosure(closure(['TAVOR', 'ZZZZZ'], 'C0002/26'), db);
    expect(match.unknownCodes).toEqual(['ZZZZZ']);
    expect(isFullyMapped(match)).toBe(false);
  });
});
