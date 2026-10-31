# T05 finish: offline maps (dashboard ticket T05; beads efb-zfm.5)

The previous agent implemented most of this and was stopped while verifying, because the simulator host crashed (since fixed).
Original brief: docs/handoff/T05.md. Current code:
- efb-212/Services/OfflineMapService.swift
- efb-212/Views/Settings/OfflineMapsView.swift
- the layer-panel status line in LayerControlsView
- efb-212UITests/OfflineMapsTmpTests.swift (its throwaway UI test)
The full unit suite passes (478 tests; the only failures are unrelated georef tests another agent is fixing).

## What to do
1. Review the implementation against docs/handoff/T05.md acceptance and fill any gaps:
   - region list;
   - size estimate, progress, pause/cancel/delete;
   - "Offline: ready / partial / not downloaded" in the layer panel;
   - the sectional cycle with an expired state;
   - Settings copy on what is offline vs online;
   - Satellite/Terrain excluded from bulk download (docs/TILE-SOURCES.md).
2. Verify for real in the simulator (through tools/sim-test.sh only): download a SMALL region around KPAO, then prove the map renders the downloaded tiles with the network unavailable. Document exactly how you verified it in `bd update efb-zfm.5 --notes`.
3. Screenshots (Settings > offline maps with a finished download, the layer-panel status, the map rendering offline) go in docs/design/screenshots/T05/ and become dashboard deliverables.
4. Delete efb-212UITests/OfflineMapsTmpTests.swift when done.

Follow docs/handoff/COMMON.md. Its simulator rules are strict: only tools/sim-test.sh; never create, boot or shut down simulators. Another agent (T11) shares the sim through the same lock.
