# S1c port notes: chart packs (R2), airport diagram georeferencing, terminal procedures

Sources -> targets:

- `Services/IsraelChartManifest.swift` -> `services/charts/manifest.ts`
- `Services/IsraelChartService.swift` (`ChartPackService`) -> `services/charts/chartPackService.ts`
- `Services/IsraelChartStore.swift`, `IsraelDiagramStore.swift` -> `services/charts/chartStores.ts` (+ `downloadSlot.ts`)
- `Services/IsraelDiagramPack.swift` -> `services/charts/diagramPack.ts`
- `AirportDiagramGeoreference` wire type and transform math (from `AirportDiagramGeoreferencer.swift`, decode side only)
  -> `services/charts/diagramGeoreference.ts`
- `Services/TerminalProcedureService.swift` -> `services/terminal/{dtpp,xml,terminalProcedureService}.ts`
- Native: `adapters/chartFileSystem.ts`, `adapters/fileDownloader.ts` (expo-file-system).

Tests: `IsraelChartServiceTests` 18 of 18, `IsraelAirportDiagramTests` 10 of 12, `TerminalProcedureServiceTests` 15 of 15.
Not ported from `IsraelAirportDiagramTests`: `regionGating` (Region.isAvailable is L1's, already covered there) and
`nearestGeoreferencedAerodromes` (it tests `AirportDiagramOverlay.georeferencedAerodromes`, a map overlay: M4).
`MockTerminalProcedureService` is dropped (double). `AirportChartsSection.grouped` is ported as `groupCharts` because the
Swift terminal test calls it; the view stays M4. The stores have no Swift tests; their tests are new. 80 tests in total (43 ported, 37 new).
`IsraelDiagramSettingsSummaryTests` (ViewModelTests) is a U7 case and is not here.

## The interface the map track (M4) consumes (owner decision Q6, STABLE)

Chart packs carry the precomputed georeferencing; nothing is computed on the device.

- `loadDiagramPack({ service, fs, servedEdition, allowUnpublished })` -> `IsraelDiagramPack | null`
- `pack.availability(icao)` -> `georeferenced | sheetOnly | none`; `pack.georeferencedICAOs`; `pack.diagramFiles(icao)` ->
  `{ imagePath, georeferencePath, sheetPath }`; `pack.badgeText`
- `loadGeoreference(pack, fs, icao)` -> `{ georeference, imagePath } | null` (null for sheet-only, missing or invalid files)
- `AirportDiagramGeoreference` (diagramGeoreference.ts): same JSON as Swift's Codable type, so packs built by
  `tools/caai-apd` decode unchanged. `clipCorners(g)` gives the four ground corners in MapLibre image-source order,
  `coordinateForPagePoint` / `pagePointForCoordinate` convert both ways. A singular transform or an off-globe reference
  is rejected at decode (JS-only guard): a wrong overlay is worse than none.
- Store: `IsraelDiagramStore` (`pack`, `availability`, `refresh`, `startDownload`) and `IsraelChartStore` (`packPath` for
  the MBTiles file, `status`, `badgeText`).

## Shape

- Services take `FetchLike`, `Clock` and, new here, `ChartFileSystem` + `FileDownloader` (charts/ports.ts). Metadata reads
  (`exists`, `size`) are synchronous (expo-file-system's are), data reads are async, so `installed()` and `load` are async
  where Swift was synchronous. Hashing goes through a pure-TypeScript incremental SHA-256 (`sha256.ts`, tested against the
  published vectors and node crypto) so no native crypto dependency is added.
- Times are epoch ms; `installed.json` is `{ product, edition, editionLabel, files[], installedAtMs }` (new JSON, clean slate).
- Observation: `subscribe` / `getVersion` instead of `@Observable`.

## Differences from Swift

- Streaming: Swift streams `URLSession.bytes` into a file handle with Range resume. JS uses a `FileDownloader` port. The
  fake honours Range (206 appends, 200 replaces) and the service logic is tested for resume. The native adapter
  (`fileDownloader.ts`) cannot append, so it restarts from byte 0 on every attempt until the device check (I3) shows
  resume is needed; the service treats that 200 as "server ignored Range".
- Offline detection: every downloader or index fetch failure other than cancellation or an HTTP status is
  `networkUnavailable` (Swift: any `session` error). HTTP statuses stay `chartDownloadFailed`.
- `waitsForConnectivity`, the 20 minute resource timeout and `allowsExpensiveNetworkAccess` have no equivalent.
- No `Telemetry.signal("ChartPack.installed")` (Q7: first-party telemetry is its own ticket).
- `isExcludedFromBackup` is an optional `excludeFromBackup` on the file-system port; the native adapter does not implement it yet.
- The R2 base URL is the public dev URL from Swift; the `israelChartBaseURL` / `ISRAEL_CHART_BASE_URL` overrides are
  injected by the caller (`baseUrl`), as is the DEBUG-only `allowUnpublished` (the caller must return false in release).
- `IsraelDiagramStore.servedEdition` lives in a `TextStorage` key instead of UserDefaults.
- d-TPP: the metafile is parsed from a string by a small SAX tokenizer instead of `XMLParser` (no entity expansion;
  malformed XML is `chartCorrupted`). `session.download` becomes `FileDownloader` to a temp file. Two-digit metafile years
  are always 20xx. `cycle(code:near:)` is `cycleWithCode`.
- Swift `Decodable` strictness is kept for manifests, indexes and georeference JSON (required fields, wrong types reject).

## JS-only guards (security and races)

- Manifest-supplied `edition` and file names, a d-TPP `pdf_name` and a cycle code become path components and URL parts:
  they must match a strict pattern (no separators, dot segments or control characters), otherwise the download is refused
  before any request. Swift trusted them. d-TPP keeps Swift's `lastPathComponent` rule (`../../evil.PDF` -> `evil.PDF`).
- A manifest `url` is only followed when it is https (or http when the base itself is http, for local staging); a
  `path` with dot segments or a scheme is ignored. Without this a manifest could point the download at `file://` or an
  internal host. The sha256 still comes from the same manifest, so this bounds where bytes come from, not who signs them.
- One download per product at a time (they share a staging folder): the same edition joins, another is refused.
  `remove()` aborts a running download, waits for it, then deletes, and downloads are refused while a removal runs.
- Stores run downloads in a `DownloadSlot`: a paused, replaced or removed run can never write state after the action that
  superseded it; an overtaken `refresh()` is dropped; `reload()` likewise.
- Cancellation checks sit before verification and before the install move, so an abort never installs.
- `verifyInstalled` failure goes through `remove()` (stops a running download first).
- d-TPP: concurrent loads share one index load, concurrent requests for the same PDF share one download, a failed load is
  never cached, temp files are always cleaned up, a corrupt cached PDF is re-downloaded.

## Preserved Swift behaviour worth knowing

- A pack is only offered when published AND validation passed; "latest" for pilots is the index's `latest`, never the max.
- Installing an edition removes every other edition folder only after the new record is written.
- `IsraelDiagramStore.refresh` keeps `latest = nil` when the host check fails (Swift `try?`).
- d-TPP serves the newest cached cycle, even expired, when offline; the UI flags it.

## Risks for the device checks (I3)

- Pure-JS SHA-256 speed on Hermes with a real MBTiles pack (hashed once per download and once per launch).
- `Directory.move` and `File.downloadFileAsync` semantics on both platforms; backup exclusion; resume.
