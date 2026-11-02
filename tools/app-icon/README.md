# App icon

`render.swift` draws the Kanaf icon with CoreGraphics (the app's own ownship chevron over a compass ring and a faint
airspace arc; no text, no third-party marks) and writes the three 1024x1024 PNGs the asset catalog needs. `icon.svg` is
the default variant with the same geometry, written by the same script.

```bash
swift tools/app-icon/render.swift efb-212/Assets.xcassets/AppIcon.appiconset
```

|File|Variant|Alpha|
|---|---|---|
|`AppIcon-1024.png`|default, aviation blue, white glyph|none (opaque)|
|`AppIcon-1024-dark.png`|dark, navy field, light glyph|none (opaque)|
|`AppIcon-1024-tinted.png`|tinted, white glyph on transparent|yes|

Check after rendering: `sips -g hasAlpha -g pixelWidth <file>`. Default and dark must say `hasAlpha: no`. iOS applies the
corner mask, so the artwork is a full square. Don't edit `icon.svg` by hand; change `render.swift` and re-run it.
