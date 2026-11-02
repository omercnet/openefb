//
//  LocationService.swift
//  efb-212
//
//  GPS tracking via CLLocationUpdate.liveUpdates(.otherNavigation) AsyncSequence.
//  Updates AppState ownship properties on MainActor with aviation unit conversions.
//  CLBackgroundActivitySession enables background GPS per NAV-07.
//
//  Position quality (GPS status chip, stale greying) is derived elsewhere from the
//  CLLocation stored in AppState (timestamp, accuracies) plus the stationary flag set here.
//

import CoreLocation

final class LocationService: LocationServiceProtocol, @unchecked Sendable {

    // MARK: - Properties

    private var trackingTask: Task<Void, Never>?
    private var backgroundSession: CLBackgroundActivitySession?
    private(set) var isTracking: Bool = false
    private weak var appState: AppState?

    // VSI computation state
    private var previousAltitudeFeet: Double?
    private var previousAltitudeTime: Date?

    // MARK: - Init

    nonisolated init(appState: AppState) {
        self.appState = appState
    }

    // MARK: - Tracking

    func startTracking() async {
        // Reset VSI state
        previousAltitudeFeet = nil
        previousAltitudeTime = nil

        // Enable background GPS tracking per NAV-07
        backgroundSession = CLBackgroundActivitySession()
        isTracking = true

        // Cold start with no fix and no explicit failure: say so after the grace period.
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(GPSFailureReason.noFixGraceSeconds))
            await MainActor.run { [weak self] in
                guard let appState = self?.appState,
                      self?.isTracking == true,
                      !appState.firstLocationReceived,
                      appState.gpsFailure == nil else { return }
                appState.gpsFailure = .noFixYet
            }
        }

        trackingTask = Task { [weak self] in
            let updates = CLLocationUpdate.liveUpdates(.otherNavigation)

            do {
                for try await update in updates {
                    guard !Task.isCancelled else { break }
                    guard let self else { break }

                    // CoreLocation pauses updates while the device is stationary and tells us
                    // so once. The last fix stays valid; the status chip must not age it out.
                    let isStationary = update.stationary

                    guard let location = update.location else {
                        // No position in this update: stationary notice keeps the last fix;
                        // anything else (denied, unavailable) means the stream is not usable.
                        await MainActor.run { [weak self] in
                            guard let appState = self?.appState else { return }
                            if isStationary {
                                appState.gpsStationary = true
                            } else if let reason = GPSFailureReason.from(
                                authorizationDenied: update.authorizationDenied || update.authorizationDeniedGlobally,
                                authorizationRestricted: update.authorizationRestricted,
                                locationUnavailable: update.locationUnavailable
                            ) {
                                appState.gpsAvailable = false
                                appState.gpsFailure = reason
                            }
                        }
                        continue
                    }

                    // Convert to aviation units
                    let speedKnots = max(0, location.speed * 1.94384)  // m/s to knots
                    let altitudeFeet = (location.altitude / 0.3048)  // meters to feet MSL
                    let roundedAltitude = (altitudeFeet / 10.0).rounded() * 10.0  // rounded to nearest 10 feet
                    let trackDegrees = location.course >= 0 ? location.course : 0  // degrees true

                    // Compute VSI from successive altitude samples (feet per minute)
                    let now = Date()
                    var computedVSI: Double = 0
                    if let prevAlt = self.previousAltitudeFeet,
                       let prevTime = self.previousAltitudeTime {
                        let timeDelta = now.timeIntervalSince(prevTime)
                        if timeDelta > 0.1 {  // avoid division by near-zero
                            computedVSI = (altitudeFeet - prevAlt) / timeDelta * 60  // fpm
                        }
                    }
                    self.previousAltitudeFeet = altitudeFeet
                    self.previousAltitudeTime = now

                    // Update AppState on MainActor
                    await MainActor.run { [weak self] in
                        guard let appState = self?.appState else { return }
                        appState.ownshipPosition = location
                        appState.groundSpeed = speedKnots            // knots
                        appState.altitude = roundedAltitude           // feet MSL, rounded to 10
                        appState.verticalSpeed = computedVSI          // fpm
                        appState.track = trackDegrees                 // degrees true
                        appState.gpsAvailable = true
                        appState.gpsFailure = nil
                        appState.gpsStationary = isStationary
                        appState.updateActiveRouteProgress()

                        if !appState.firstLocationReceived {
                            appState.firstLocationReceived = true
                        }
                    }
                }
            } catch {
                // CLLocationUpdate.liveUpdates() can throw if cancelled or authorization denied
                await MainActor.run { [weak self] in
                    self?.appState?.gpsAvailable = false
                    self?.appState?.gpsFailure = .streamFailed
                }
            }
        }
    }

    func stopTracking() {
        trackingTask?.cancel()
        trackingTask = nil
        backgroundSession?.invalidate()
        backgroundSession = nil
        isTracking = false
    }
}
