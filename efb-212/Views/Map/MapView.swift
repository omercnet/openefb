//
//  MapView.swift
//  efb-212
//
//  UIViewRepresentable wrapper for MLNMapView with GeoJSON source management.
//  Creates the map, sets initial CONUS center, wires delegate through Coordinator,
//  and adds tap gesture for GeoJSON feature detection (airport tapping).
//
//  Ownship is always our own chevron: showsUserLocation stays off and userTrackingMode
//  is never set, so the system blue puck can never appear (design finding F4).
//

import SwiftUI
import MapLibre

struct MapView: UIViewRepresentable {

    let mapService: MapService
    let mapViewModel: MapViewModel
    /// Effective scheme set by DisplayModeModifier (dark = night palette).
    @Environment(\.colorScheme) private var colorScheme

    // MARK: - UIViewRepresentable

    func makeCoordinator() -> Coordinator {
        Coordinator(mapViewModel: mapViewModel, mapService: mapService)
    }

    func makeUIView(context: Context) -> MLNMapView {
        let mapView = MLNMapView(frame: .zero)

        // Initial CONUS center (39N, 98W, zoom 5) per user decision
        mapView.setCenter(
            CLLocationCoordinate2D(latitude: 39.0, longitude: -98.0),
            zoomLevel: 5.0,
            animated: false
        )

        // We render our own ownship -- never show the system puck
        mapView.showsUserLocation = false

        // Hide default compass -- we provide our own north indicator
        mapView.compassView.compassVisibility = .hidden

        // Set delegate through coordinator
        mapView.delegate = context.coordinator

        // Configure MapService with this map view
        mapService.configure(mapView: mapView)

        // Add tap gesture for GeoJSON feature detection (airport tapping)
        let tapGesture = UITapGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handleMapTap(_:))
        )
        // Don't interfere with map's own gesture recognizers
        for recognizer in mapView.gestureRecognizers ?? [] {
            tapGesture.require(toFail: recognizer)
        }
        mapView.addGestureRecognizer(tapGesture)

        // Age the GPS fix once a second for the status chip and stale chevron
        mapViewModel.startGPSClock()

        return mapView
    }

    func updateUIView(_ mapView: MLNMapView, context: Context) {
        // New GPS fix: chevron, first-fix jump, follow camera (de-duplicated by timestamp)
        if let position = mapViewModel.appState.ownshipPosition {
            mapViewModel.onOwnshipUpdated(position)
        }

        // Sync layer visibility
        for layer in MapLayer.allCases {
            let visible = mapViewModel.appState.visibleLayers.contains(layer)
            mapService.setLayerVisibility(layer, visible: visible)
        }

        // Sync base map style and sectional opacity (opacity only when it changed: this
        // update runs once a second for the GPS clock and a raster-opacity write re-renders)
        mapService.setMapStyle(
            mapViewModel.appState.mapStyle,
            sectional: mapViewModel.appState.visibleLayers.contains(.sectional)
        )
        mapService.applyDisplayMode(night: colorScheme == .dark)
        let opacity = mapViewModel.appState.sectionalOpacity
        if context.coordinator.appliedSectionalOpacity != opacity {
            context.coordinator.appliedSectionalOpacity = opacity
            mapService.setSectionalOpacity(opacity)
        }
    }

    // MARK: - Coordinator

    /// MapLibre calls its delegate on the main thread, so the conformance is main-actor isolated
    /// (SE-0470) rather than hopping in each callback.
    class Coordinator: NSObject, @MainActor MLNMapViewDelegate {
        let mapViewModel: MapViewModel
        let mapService: MapService

        /// Last sectional opacity pushed to the map (nil until the first update).
        var appliedSectionalOpacity: Double?

        init(mapViewModel: MapViewModel, mapService: MapService) {
            self.mapViewModel = mapViewModel
            self.mapService = mapService
            super.init()
        }

        /// Pan and rotate gestures hand the camera to the user and suspend follow.
        /// Pinch/zoom gestures keep following (the next fix re-centres).
        nonisolated private static func isUserMove(_ reason: MLNCameraChangeReason) -> Bool {
            reason.contains(.gesturePan) || reason.contains(.gestureRotate)
        }

        // Style finished loading -- initialize all layers
        @MainActor
        func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            mapViewModel.onMapStyleLoaded(style: style)
        }

        // Camera moving (gesture or animation): suspend follow on user drag right away so the
        // Recenter button appears while the finger is still down; keep the north indicator live.
        @MainActor
        func mapView(_ mapView: MLNMapView, regionIsChangingWith reason: MLNCameraChangeReason) {
            if Self.isUserMove(reason) {
                mapViewModel.onUserMovedMap()
            }
            mapViewModel.onMapDirectionChanged(mapView.direction)
        }

        // Region changed -- trigger debounced data reload sized from the visible bounds.
        // Implementing the reason-bearing variant means MapLibre no longer calls
        // regionDidChangeAnimated, so this is the only region-change entry point.
        @MainActor
        func mapView(_ mapView: MLNMapView, regionDidChangeWith reason: MLNCameraChangeReason, animated: Bool) {
            if Self.isUserMove(reason) {
                mapViewModel.onUserMovedMap()
            }
            let bounds = mapView.visibleCoordinateBounds
            mapViewModel.onRegionChanged(
                center: mapView.centerCoordinate,
                zoom: mapView.zoomLevel,
                northEast: bounds.ne,
                southWest: bounds.sw,
                direction: mapView.direction
            )
        }

        // Handle tap on map for GeoJSON feature detection (airports)
        @MainActor
        @objc func handleMapTap(_ sender: UITapGestureRecognizer) {
            guard sender.state == .ended else { return }
            guard let mapView = mapService.mapView else { return }

            let point = sender.location(in: mapView)

            // Query visible features at tap point in the airport circle layer
            let features = mapView.visibleFeatures(
                at: point,
                styleLayerIdentifiers: Set(["airport-circles"])
            )

            // Extract ICAO from first matching feature
            if let feature = features.first,
               let icao = feature.attribute(forKey: "icao") as? String {
                mapViewModel.onAirportTapped(icao: icao)
            }
        }
    }
}
