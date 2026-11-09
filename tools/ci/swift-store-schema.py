#!/usr/bin/env python3
"""Describe the Swift app's real on-disk data as Markdown (ticket D1): tables, columns and types, Core Data
metadata (Z_PRIMARYKEY, Z_METADATA), the GRDB recording database, UserDefaults keys and the Keychain items.

  tools/ci/swift-store-schema.py <dir>     <dir> is a tools/ci/make-fixtures.sh output for one profile
                                           (live/ and closed/ inside, plus seed-report.json)
Runs on Linux against the committed fixtures too. Reads copies only; never modifies the inputs.
"""
import json
import plistlib
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

CORE_DATA_EPOCH_NOTE = "Core Data / SwiftData dates are REAL seconds since 2001-01-01T00:00:00Z (add 978307200 for Unix time)"


def open_copy(path: Path):
    """Open a copy (with its -wal/-shm) so reading cannot touch the original."""
    tmp = Path(tempfile.mkdtemp())
    for suffix in ("", "-wal", "-shm"):
        src = Path(str(path) + suffix)
        if src.exists():
            shutil.copy(src, tmp / (path.name + suffix))
    return sqlite3.connect(str(tmp / path.name))


def describe(v):
    if v is None:
        return "NULL"
    if isinstance(v, bytes):
        head = v[:24].hex()
        text = ""
        try:
            doc = json.loads(v.decode("utf-8"))
            text = " json=" + json.dumps(doc)[:80]
        except Exception:
            if v[:6] == b"bplist":
                text = " bplist"
        return f"blob({len(v)}) {head}{text}"
    s = repr(v)
    return s if len(s) <= 60 else s[:57] + "..."


def md_table(rows, header):
    out = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    out += ["| " + " | ".join(str(c).replace("|", "\\|") for c in r) + " |" for r in rows]
    return "\n".join(out)


def schema(db, title, sample=True):
    out = [f"### {title}", ""]
    q = db.execute
    out.append(f"SQLite {sqlite3.sqlite_version}; page_size {q('PRAGMA page_size').fetchone()[0]}; "
               f"journal_mode {q('PRAGMA journal_mode').fetchone()[0]}; user_version {q('PRAGMA user_version').fetchone()[0]}")
    out.append("")
    tables = [r[0] for r in q("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    for t in tables:
        n = q(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
        out.append(f"#### `{t}` ({n} rows)")
        out.append("")
        cols = q(f'PRAGMA table_info("{t}")').fetchall()
        out.append(md_table([(c[1], c[2] or "(none)", "NOT NULL" if c[3] else "", c[4] if c[4] is not None else "", "PK" if c[5] else "") for c in cols],
                            ["column", "declared type", "null", "default", "key"]))
        idx = q(f'PRAGMA index_list("{t}")').fetchall()
        if idx:
            out.append("")
            out.append("Indexes: " + ", ".join(f"`{i[1]}`{' (unique)' if i[2] else ''}" for i in idx))
        if sample and n:
            row = q(f'SELECT * FROM "{t}" ORDER BY 1 LIMIT 1').fetchone()
            out.append("")
            out.append("First row: " + "; ".join(f"{c[1]}={describe(v)}" for c, v in zip(cols, row)))
            kinds = []
            for c in cols:
                types = [r[0] for r in q(f'SELECT DISTINCT typeof("{c[1]}") FROM "{t}"')]
                kinds.append(f"{c[1]}: {'/'.join(sorted(types))}")
            out.append("")
            out.append("Stored types: " + "; ".join(kinds))
        out.append("")
    return "\n".join(out)


def core_data_meta(db):
    out = ["#### Core Data metadata", ""]
    out.append(CORE_DATA_EPOCH_NOTE)
    out.append("")
    if db.execute("SELECT 1 FROM sqlite_master WHERE name='Z_PRIMARYKEY'").fetchone():
        rows = db.execute("SELECT Z_ENT, Z_NAME, Z_SUPER, Z_MAX FROM Z_PRIMARYKEY ORDER BY Z_ENT").fetchall()
        out.append("`Z_PRIMARYKEY` (entity number -> table suffix, Z_MAX = last Z_PK handed out):")
        out.append("")
        out.append(md_table(rows, ["Z_ENT", "Z_NAME", "Z_SUPER", "Z_MAX"]))
        out.append("")
    if db.execute("SELECT 1 FROM sqlite_master WHERE name='Z_METADATA'").fetchone():
        row = db.execute("SELECT Z_VERSION, Z_UUID, Z_PLIST FROM Z_METADATA").fetchone()
        out.append(f"`Z_METADATA`: Z_VERSION={row[0]}, Z_UUID={row[1]}")
        try:
            plist = plistlib.loads(row[2])
            out.append("")
            out.append("Z_PLIST keys: " + ", ".join(f"`{k}`" for k in sorted(plist)))
            for k in sorted(plist):
                v = plist[k]
                if isinstance(v, dict):
                    out.append(f"- `{k}`: {len(v)} entries: " + ", ".join(sorted(map(str, v)))[:300])
                else:
                    out.append(f"- `{k}`: {str(v)[:200]}")
        except Exception as exc:  # noqa: BLE001
            out.append(f"Z_PLIST not decoded: {exc}")
        out.append("")
    if db.execute("SELECT 1 FROM sqlite_master WHERE name='Z_MODELCACHE'").fetchone():
        n = db.execute("SELECT COUNT(*), COALESCE(SUM(LENGTH(Z_CONTENT)),0) FROM Z_MODELCACHE").fetchone()
        out.append(f"`Z_MODELCACHE`: {n[0]} row(s), {n[1]} bytes of cached model (ignore in the importer).")
        out.append("")
    return "\n".join(out)


def find(base: Path, pattern):
    return sorted(base.glob(pattern))


def main():
    base = Path(sys.argv[1])
    out = [f"## Swift on-disk data generated from `{base.name}`", ""]
    report = base / "seed-report.json"
    if report.exists():
        r = json.loads(report.read_text())
        out += ["### Paths inside the app container (from the seed report)", "",
                f"- SwiftData store (`ModelConfiguration()` without URL): `{r.get('swiftDataStoreURL', '')}`",
                f"- Application Support: `{r.get('applicationSupport', '')}`", "",
                "Files under Application Support after the seed run:", "",
                md_table([(f["path"], f["bytes"]) for f in r.get("applicationSupportFiles", [])], ["path", "bytes"]), "",
                f"Model counts: {json.dumps(r.get('modelCounts', {}), sort_keys=True)}", ""]
    for state in ("live", "closed"):
        d = base / state
        stores = find(d, "support/default.store") or find(d, "support/**/default.store")
        if not stores:
            continue
        sizes = {p.name: p.stat().st_size for p in sorted(stores[0].parent.glob("default.store*"))}
        out += [f"### SwiftData store, {state} copy", "",
                ("Copied while the app was still running (-wal and -shm as an in-use store leaves them)." if state == "live"
                 else "Copied after the app was terminated."), "",
                "Files: " + ", ".join(f"`{k}` {v} B" for k, v in sizes.items()), ""]
        if state == "live":
            db = open_copy(stores[0])
            out.append(core_data_meta(db))
            out.append(schema(db, "SwiftData tables (`default.store`)"))
            db.close()
    rec = find(base / "live", "support/**/recording.sqlite")
    if rec:
        sizes = {p.name: p.stat().st_size for p in sorted(rec[0].parent.glob("recording.sqlite*"))}
        out += ["### GRDB recording database", "", "Files: " + ", ".join(f"`{k}` {v} B" for k, v in sizes.items()), ""]
        db = open_copy(rec[0])
        out.append(schema(db, "Recording tables (`efb-212/recording.sqlite`)"))
        db.close()
    plists = sorted((base / "closed").glob("*.plist")) + sorted((base / "live").glob("*.plist"))
    for p in plists:
        try:
            data = plistlib.loads(p.read_bytes())
        except Exception:  # noqa: BLE001
            continue
        out += [f"### UserDefaults: `{p.relative_to(base)}`", "",
                md_table([(k, type(v).__name__, str(v)[:60]) for k, v in sorted(data.items())], ["key", "plist type", "value"]), ""]
    if report.exists():
        items = json.loads(report.read_text()).get("keychainItems", [])
        out += ["### Keychain generic-password items (attributes only)", "",
                md_table([(i.get("service", ""), i.get("account", ""), i.get("accessible", ""), i.get("accessGroup", i.get("status", ""))) for i in items],
                         ["service", "account", "accessible", "accessGroup / status"]), ""]
    print("\n".join(out))


if __name__ == "__main__":
    main()
