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

/// The parts of a `CLLocationUpdate` that `LocationService` reads. A Sendable value so tests can
/// feed updates without CoreLocation.
nonisolated struct LocationUpdateSnapshot: Sendable {
    let location: CLLocation?
    let stationary: Bool
    let authorizationDenied: Bool
    let authorizationDeniedGlobally: Bool
    let authorizationRestricted: Bool
    let locationUnavailable: Bool

    nonisolated init(
        location: CLLocation?,
        stationary: Bool = false,
        authorizationDenied: Bool = false,
        authorizationDeniedGlobally: Bool = false,
        authorizationRestricted: Bool = false,
        locationUnavailable: Bool = false
    ) {
        self.location = location
        self.stationary = stationary
        self.authorizationDenied = authorizationDenied
        self.authorizationDeniedGlobally = authorizationDeniedGlobally
        self.authorizationRestricted = authorizationRestricted
        self.locationUnavailable = locationUnavailable
    }
}

final class LocationService: LocationServiceProtocol, @unchecked Sendable {

    // MARK: - Properties

    private var trackingTask: Task<Void, Never>?
    private var backgroundSession: CLBackgroundActivitySession?
    private(set) var isTracking: Bool = false
    private weak var appState: AppState?
    private let makeUpdates: @Sendable () -> AsyncThrowingStream<LocationUpdateSnapshot, Error>
    private let noFixGrace: Duration

    // VSI computation state
    private var previousAltitudeFeet: Double?
    private var previousAltitudeTime: Date?
    private var restartAttempt = 0
    private let restartBaseDelay: Duration
    private let clock: @Sendable () -> Date

    // MARK: - Init

    /// - Parameters:
    ///   - appState: Receives ownship, speed, altitude and GPS status.
    ///   - updates: Source of location updates; defaults to `CLLocationUpdate.liveUpdates`. Tests inject a stream.
    ///   - noFixGrace: Time with no fix before `GPSFailureReason.noFixYet` is raised.
    ///   - restartBaseDelay: First wait before re-requesting updates after the stream throws; doubles per failure, max 30 s.
    ///   - clock: The instant route following sees as "now"; scenario playback and tests accelerate it.
    nonisolated init(
        appState: AppState,
        updates: @escaping @Sendable () -> AsyncThrowingStream<LocationUpdateSnapshot, Error> = LocationService.liveUpdates,
        noFixGrace: Duration = .seconds(GPSFailureReason.noFixGraceSeconds),
        restartBaseDelay: Duration = .seconds(1),
        clock: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.appState = appState
        self.makeUpdates = updates
        self.noFixGrace = noFixGrace
        self.restartBaseDelay = restartBaseDelay
        self.clock = clock
    }

    /// Production source: CoreLocation live updates, mapped to snapshots.
    nonisolated static func liveUpdates() -> AsyncThrowingStream<LocationUpdateSnapshot, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    for try await update in CLLocationUpdate.liveUpdates(.otherNavigation) {
                        continuation.yield(LocationUpdateSnapshot(
                            location: update.location,
                            stationary: update.stationary,
                            authorizationDenied: update.authorizationDenied,
                            authorizationDeniedGlobally: update.authorizationDeniedGlobally,
                            authorizationRestricted: update.authorizationRestricted,
                            locationUnavailable: update.locationUnavailable
                        ))
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
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
            try? await Task.sleep(for: self?.noFixGrace ?? .seconds(GPSFailureReason.noFixGraceSeconds))
            await MainActor.run { [weak self] in
                guard let appState = self?.appState,
                      self?.isTracking == true,
                      !appState.firstLocationReceived,
                      appState.gpsFailure == nil else { return }
                appState.gpsFailure = .noFixYet
            }
        }

        trackingTask = Task { [weak self] in
            // Supervisor: a throwing stream is not terminal. Report GPS lost, back off, and ask
            // CoreLocation for a fresh stream until stopTracking() cancels this task.
            while !Task.isCancelled {
                guard let self else { return }
                do {
                    try await self.consume(self.makeUpdates())
                    return  // stream ended without error
                } catch {
                    guard !Task.isCancelled else { return }
                    // CLLocationUpdate.liveUpdates() can throw if authorization is revoked or the
                    // location daemon restarts. The chip shows GPS lost until a fix arrives again.
                    await MainActor.run { [weak self] in
                        self?.appState?.gpsAvailable = false
                        self?.appState?.gpsFailure = .streamFailed
                    }
                    let delay = self.restartDelay(attempt: self.restartAttempt)
                    self.restartAttempt += 1
                    try? await Task.sleep(for: delay)
                    // A restarted stream has no previous altitude sample to difference against.
                    self.previousAltitudeFeet = nil
                    self.previousAltitudeTime = nil
                }
            }
        }
    }

    /// Delay before restart `attempt` (0-based): `restartBaseDelay` doubling, capped at 30 s.
    private func restartDelay(attempt: Int) -> Duration {
        let factor = 1 << min(attempt, 5)  // 1, 2, 4, ... 32
        return min(restartBaseDelay * factor, .seconds(30))
    }

    /// Apply every update from one stream to AppState. Throws when the stream throws.
    private func consume(_ updates: AsyncThrowingStream<LocationUpdateSnapshot, Error>) async throws {
        for try await update in updates {
            guard !Task.isCancelled else { break }

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

            restartAttempt = 0  // a real fix: the next stream failure backs off from the start

            // Convert to aviation units
            let speedKnots = max(0, location.speed * 1.94384)  // m/s to knots
            let altitudeFeet = (location.altitude / 0.3048)  // meters to feet MSL
            let roundedAltitude = (altitudeFeet / 10.0).rounded() * 10.0  // rounded to nearest 10 feet
            let trackDegrees = location.course >= 0 ? location.course : 0  // degrees true

            // Compute VSI from successive altitude samples (feet per minute), differenced over the
            // fixes' own timestamps so delayed or batched delivery does not distort it.
            let fixTime = location.timestamp
            var computedVSI: Double = 0
            if let prevAlt = previousAltitudeFeet,
               let prevTime = previousAltitudeTime {
                let timeDelta = fixTime.timeIntervalSince(prevTime)  // seconds
                if timeDelta > 0.1 {  // avoid division by near-zero; out-of-order fixes give 0
                    computedVSI = (altitudeFeet - prevAlt) / timeDelta * 60  // fpm
                }
            }
            previousAltitudeFeet = altitudeFeet
            previousAltitudeTime = fixTime

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
                appState.updateActiveRouteProgress(now: self?.clock() ?? Date())

                if !appState.firstLocationReceived {
                    appState.firstLocationReceived = true
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
