# Map tile sources

The base map styles live in `efb-212/Resources/base-style.json`. Each source and what to check before a public release:

| Style | Source | Key | Status for release |
|---|---|---|---|
| Street (and the base under VFR) | OpenFreeMap vector tiles (`tiles.openfreemap.org`) + Noto glyphs | none | Public, free, no stated rate limit. Attribution required (in the style). Fine for beta; self-hosting the same OpenMapTiles schema is the fallback. |
| VFR sectional | FAA AIS ArcGIS tile service `VFR_Sectional` (zoom 8-12) | none | FAA data is public domain. The hosted service makes no availability promise; offline packs (efb-zfm.5) reduce the dependency. |
| Satellite | Esri World Imagery (`server.arcgisonline.com`) | none | Esri's terms restrict use without an ArcGIS account/attribution, and bulk/offline download needs checking. **Verify the terms before release**; may need an Esri developer key, or drop the style. |
| Terrain | OpenTopoMap (`tile.opentopomap.org`) | none | Volunteer-run. The tile usage policy forbids heavy app traffic and bulk download. **Not acceptable for a public app** without a different host. |

Offline packs: only Street (OpenFreeMap) and the FAA sectional are downloaded by default. Satellite
and terrain are excluded from bulk download for the reasons above.

Decision (2026-10-31, Q1 = A): keep all four styles for the TestFlight beta; before the public release remove Satellite and Terrain unless licensed hosting replaces them (beads chore under efb-zfm).
