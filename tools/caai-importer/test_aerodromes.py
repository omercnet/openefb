"""Tests for the curated-aerodrome merge in import_caai.py (IL-4).

Run: .venv/bin/python -m unittest test_aerodromes -v   (from tools/caai-importer)

They need no CAAI download: the cross-check is exercised on the real curated CSV plus the ARP points and
runways of the built database (efb-212/Resources/israel-aviation.sqlite), and on small broken variants."""

import csv
import io
import sqlite3
import tempfile
import unittest
from pathlib import Path

import import_caai as ic

CURATED = ic.DEFAULT_CURATED


def gis_from_database():
    """ARP points and runway rows exactly as build_points / build_runways produce them, read back from the built DB."""
    db = sqlite3.connect(str(ic.DEFAULT_OUTPUT))
    db.row_factory = sqlite3.Row
    points = [dict(r) for r in db.execute("SELECT code, name_en, kind, lat, lon FROM reporting_points WHERE kind = 'arp'")]
    runways = [dict(r) for r in db.execute(
        "SELECT id, aerodrome, name_en, length_m, arp_lat, arp_lon, a_lat, a_lon, b_lat, b_lon FROM runways")]
    db.close()
    return points, runways


def rewrite_csv(mutator):
    """The curated CSV with `mutator(rows)` applied, written to a temp file; returns its path."""
    with open(CURATED, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fields, rows = reader.fieldnames, list(reader)
    mutator(rows)
    tmp = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, newline="", encoding="utf-8")
    writer = csv.DictWriter(tmp, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
    tmp.close()
    return Path(tmp.name)


class CrossCheck(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.aerodromes, cls.runways, cls.frequencies = ic.load_curated(CURATED)
        cls.points, cls.gis_runways = gis_from_database()

    def test_every_arp_point_and_runway_resolves(self):
        ic.cross_check_aerodromes(self.aerodromes, self.points, self.gis_runways)  # raises on any orphan
        self.assertEqual(sum(1 for p in self.points if p["kind"] == "arp"), 25)
        self.assertEqual(len(self.gis_runways), 42)

    def test_orphan_arp_point_fails_loudly(self):
        without_herzliya = [a for a in self.aerodromes if a["code"] != "LLHZ"]
        with self.assertRaises(ic.ImportFailure) as raised:
            ic.cross_check_aerodromes(without_herzliya, self.points, self.gis_runways)
        self.assertIn("LLHZ", str(raised.exception))
        self.assertIn("no aerodrome row", str(raised.exception))

    def test_orphan_runway_fails_loudly(self):
        # Take Habonim (LLBO) out: its ARP point and its coded runway row both lose their aerodrome.
        without = [a for a in self.aerodromes if a["code"] != "LLBO"]
        with self.assertRaises(ic.ImportFailure) as raised:
            ic.cross_check_aerodromes(without, [], self.gis_runways)
        self.assertIn("runway id", str(raised.exception))
        self.assertIn("LLBO", str(raised.exception))

    def test_uncoded_military_runway_resolves_by_position_or_fails(self):
        uncoded = [w for w in self.gis_runways if not w["aerodrome"]]
        self.assertGreater(len(uncoded), 0)
        no_military = [a for a in self.aerodromes if a["use"] not in ("military", "foreign")]
        with self.assertRaises(ic.ImportFailure) as raised:
            ic.cross_check_aerodromes(no_military, [], self.gis_runways)
        self.assertIn("no aerodrome row within", str(raised.exception))

    def test_arp_point_far_from_its_row_fails(self):
        moved = [dict(a, lat=a["lat"] + 0.5) if a["code"] == "LLRD" else a for a in self.aerodromes]
        with self.assertRaises(ic.ImportFailure) as raised:
            ic.cross_check_aerodromes(moved, self.points, [])
        self.assertIn("LLRD", str(raised.exception))


class CuratedFile(unittest.TestCase):
    def load(self, mutator):
        path = rewrite_csv(mutator)
        try:
            return ic.load_curated(path)
        finally:
            path.unlink()

    def test_real_file_counts_and_status(self):
        aerodromes, runways, frequencies = ic.load_curated(CURATED)
        self.assertEqual(len(aerodromes), len({a["code"] for a in aerodromes}))
        self.assertEqual({a["review_status"] for a in aerodromes}, {"unreviewed"})
        herzliya = next(a for a in aerodromes if a["code"] == "LLHZ")
        self.assertEqual(herzliya["elevation_ft"], 121)
        self.assertEqual([r["designator"] for r in runways if r["aerodrome"] == "LLHZ"], ["10/28"])
        self.assertIn("122.200", [f["mhz"] for f in frequencies if f["aerodrome"] == "LLHZ"])

    def test_negative_elevation_survives(self):
        aerodromes, _, _ = ic.load_curated(CURATED)
        self.assertEqual(next(a for a in aerodromes if a["code"] == "LLMZ")["elevation_ft"], -1233)

    def test_duplicate_code_rejected(self):
        def dup(rows):
            rows.append(dict(rows[0]))
        with self.assertRaises(ic.ImportFailure):
            self.load(dup)

    def test_unknown_review_status_rejected(self):
        def bad(rows):
            rows[0]["review_status"] = "approved"
        with self.assertRaises(ic.ImportFailure):
            self.load(bad)

    def test_value_without_source_rejected(self):
        def bad(rows):
            row = next(r for r in rows if r["code"] == "LLHZ")
            row["source_frequencies"] = ""
        with self.assertRaises(ic.ImportFailure) as raised:
            self.load(bad)
        self.assertIn("frequencies", str(raised.exception))

    def test_unparsable_runway_rejected(self):
        def bad(rows):
            next(r for r in rows if r["code"] == "LLHZ")["runways"] = "ten twenty-eight"
        with self.assertRaises(ic.ImportFailure):
            self.load(bad)

    def test_frequency_outside_air_band_rejected(self):
        def bad(rows):
            next(r for r in rows if r["code"] == "LLHZ")["frequencies"] = "212.200 TWR"
        with self.assertRaises(ic.ImportFailure):
            self.load(bad)

    def test_coordinates_outside_israel_rejected(self):
        def bad(rows):
            next(r for r in rows if r["code"] == "LLHZ")["lat"] = "51.5"
        with self.assertRaises(ic.ImportFailure):
            self.load(bad)


if __name__ == "__main__":
    unittest.main()
