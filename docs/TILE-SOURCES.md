# Map tile sources

The base map styles live in `efb-212/Resources/base-style.json`. Each source and what to check before a public release:

| Style | Source | Key | Status for release |
|---|---|---|---|
| Street (and the base under VFR) | OpenFreeMap vector tiles (`tiles.openfreemap.org`) + Noto glyphs | none | Public, free, no stated rate limit. Attribution required (in the style). Fine for beta; self-hosting the same OpenMapTiles schema is the fallback. |
| VFR sectional | FAA AIS ArcGIS tile service `VFR_Sectional` (zoom 8-12) | none | FAA data is public domain. The hosted service makes no availability promise; offline packs (efb-zfm.5) reduce the dependency. |

Satellite (Esri World Imagery) and Terrain (OpenTopoMap) were removed from the app before the external TestFlight
(2026-11-02): their terms don't allow public distribution (Esri restricts use without an ArcGIS account; the OpenTopoMap usage
policy forbids heavy app traffic). Re-adding either needs licensed hosting first.

Offline packs: only Street (OpenFreeMap) and the FAA sectional are downloaded.
