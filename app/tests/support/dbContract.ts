import type { Db } from '../../src/data/db';

/** Behaviour every Db adapter must have. Run it against each adapter (Node sqlite here, expo-sqlite on a device). */
export function runDbContract(name: string, open: () => Promise<Db>): void {
  describe(`${name} Db contract`, () => {
    let db: Db;
    beforeEach(async () => {
      db = await open();
      await db.run('CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT NOT NULL)');
    });

    it('inserts and reads rows', async () => {
      const r = await db.run('INSERT INTO t (label) VALUES (?)', ['a']);
      expect(r.changes).toBe(1);
      expect(await db.get('SELECT label FROM t WHERE id = ?', [r.lastInsertRowId])).toEqual({ label: 'a' });
      expect(await db.all('SELECT id FROM t')).toHaveLength(1);
    });

    it('returns null from get when no row matches', async () => {
      expect(await db.get('SELECT * FROM t WHERE id = ?', [99])).toBeNull();
    });

    it('commits a transaction that resolves', async () => {
      await db.transaction(async (tx) => {
        await tx.run('INSERT INTO t (label) VALUES (?)', ['a']);
      });
      expect(await db.all('SELECT * FROM t')).toHaveLength(1);
    });

    it('rolls back a transaction that rejects and rethrows', async () => {
      await expect(
        db.transaction(async (tx) => {
          await tx.run('INSERT INTO t (label) VALUES (?)', ['a']);
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(await db.all('SELECT * FROM t')).toHaveLength(0);
    });

    it('supports R-tree queries (the aviation database needs them)', async () => {
      await db.run('CREATE VIRTUAL TABLE airports_rtree USING rtree(id, min_lon, max_lon, min_lat, max_lat)');
      await db.run('INSERT INTO airports_rtree VALUES (1, 34.8, 34.9, 32.1, 32.2)');
      await db.run('INSERT INTO airports_rtree VALUES (2, -122.2, -122.1, 37.4, 37.5)');
      const inBox = await db.all<{ id: number }>(
        'SELECT id FROM airports_rtree WHERE min_lon >= ? AND max_lon <= ? AND min_lat >= ? AND max_lat <= ?',
        [34, 35, 32, 33],
      );
      expect(inBox).toEqual([{ id: 1 }]);
    });
  });
}
