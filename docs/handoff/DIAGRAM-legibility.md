# Airport diagram legibility (beads efb-2zs; dashboard ticket T18)

See docs/design/screenshots/T11/kpao-trackup.png. At zoom ~15 the FAA sectional (native max zoom 12) is upscaled into large
blurry blocks behind the black-on-transparent airport diagram, so the taxiways are hard to read.

## Files you own
efb-212/Services/AirportDiagramOverlay.swift. In MapService, only the paint of base and sectional layers at high zoom, kept
minimal; another agent (T08) may edit views, not MapService.

## Change
- While a validated diagram is shown, make it readable:
  - a light backing within the diagram quad (e.g. a white fill at ~85%), or fade the sectional and base layers above zoom 14
    with zoom-dependent opacity expressions;
  - pick what reads best and keep ownship and airport symbols on top.
- Night mode (Core/DisplayMode.swift, MapService.applyDisplayMode): the diagram must not be a bright white slab at night.
  Use an inverted (light-on-dark) or dimmed rendering.
- Keep the "Advisory, verify against the charted diagram" caveat.

## Acceptance
Before/after screenshots at KPAO and KSQL (zoom ~15, north-up and track-up), day and night, in
docs/design/screenshots/diagram-legibility/, added as deliverables. Full unit suite green (SIM_TAG=T18).
