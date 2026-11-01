//
//  IsraelOfficialChartLayer.swift
//  efb-212
//
//  The official CAAI CVFR chart as the Israel base chart (IL-9). Reads the downloaded MBTiles pack
//  directly through MapLibre's `mbtiles://` file source and draws it above the street base and below
//  every flight layer, so the CVFR vector overlay (IsraelChartOverlay) stays on top, unrestyled.
//  Outside the chart's footprint (legends and insets are masked, the sea beyond the sheets) the
//  street base shows through.
//

import Foundation
import MapLibre

@MainActor
final class IsraelOfficialChartLayer {
    static let sourceID = "israel-official-chart-source"
    static let layerID = "israel-official-chart"

    private weak var style: MLNStyle?
    private(set) var packURL: URL?
    private var night = false

    /// A fresh style finished loading: every layer of the old one is gone.
    func attach(style: MLNStyle) {
        self.style = style
        install()
    }

    /// Point the layer at an installed pack, or nil to remove it (nothing downloaded, or leaving Israel).
    func setPack(_ url: URL?) {
        guard url != packURL else { return }
        packURL = url
        install()
    }

    func applyDisplayMode(night newNight: Bool) {
        night = newNight
        applyNight()
    }

    /// `mbtiles:///absolute/path`; the path is percent-encoded because Application Support has a space.
    nonisolated static func sourceURL(for file: URL) -> URL? {
        let encoded = file.path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? file.path
        return URL(string: "mbtiles://" + encoded)
    }

    private func install() {
        guard let style else { return }
        if let old = style.layer(withIdentifier: Self.layerID) { style.removeLayer(old) }
        if let oldSource = style.source(withIdentifier: Self.sourceID) { style.removeSource(oldSource) }
        guard let packURL, let url = Self.sourceURL(for: packURL) else { return }
        let source = MLNRasterTileSource(identifier: Self.sourceID, configurationURL: url, tileSize: 256)
        style.addSource(source)
        let layer = MLNRasterStyleLayer(identifier: Self.layerID, source: source)
        // Above the street and base raster layers, below everything the app draws for the flight.
        if let lastBase = style.layers.last(where: { $0.identifier.hasPrefix("street-") || $0.identifier.hasPrefix("base-") }) {
            style.insertLayer(layer, above: lastBase)
        } else {
            style.addLayer(layer)
        }
        applyNight()
    }

    private func applyNight() {
        guard let layer = style?.layer(withIdentifier: Self.layerID) as? MLNRasterStyleLayer else { return }
        layer.maximumRasterBrightness = NSExpression(forConstantValue: night ? NightPalette.rasterBrightnessMax : 1.0)
        layer.rasterSaturation = NSExpression(forConstantValue: night ? NightPalette.rasterSaturation : 0.0)
    }
}
