//
//  AppState.swift
//  efb-212
//
//  Root state coordinator -- @Observable macro with @MainActor isolation.
//  Injected into view hierarchy via .environment(appState).
//  All sub-state properties organized by concern.
//

import Observation
import CoreLocation

/// Lightweight transcript segment for UI display in the live transcription panel.
struct TranscriptDisplayItem: Identifiable, Sendable {
    let id: UUID
    let text: String
    let timestamp: Date
    let isVolatile: Bool
}

@Observable
@MainActor
final class AppState {

    // MARK: - Navigation State

    var selectedScreen: AppScreen = .map
    /// What the strip column beside the chart shows; the in-flight log by default.
    var stripColumn: StripColumn = .log
    var selectedAirportID: String?
    /// Israel NOTAM briefing sheet over the map (IL-BRIEF).
    var isPresentingIsraelBriefing: Bool = false
    var searchQuery: String = ""

    // MARK: - Region (IL-2)

    /// Operating region; chooses the map home, weather stations, altimeter unit and which data
    /// layers exist. Persisted in UserSettings through `RegionStore`. Changing it recentres the
    /// map and drops layers the new region has no source for.
    var region: Region = .us {
        didSet {
            Telemetry.setRegion(region)
            guard region != oldValue else { return }
            mapCenter = region.defaultCenter
            mapZoom = region.defaultZoom
            visibleLayers = visibleLayers.filter { region.supports($0) }
            if region != .us {
                if !region.availableMapStyles.contains(mapStyle) { mapStyle = .street }
                // The region's own METAR stations are the only live data there: show them.
                if !region.weatherStations.isEmpty { visibleLayers.insert(.weatherDots) }
                // The CVFR chart is the region's chart: on by default (Israel only; the US has none).
                visibleLayers.formUnion(MapLayer.cvfrChart.filter { region.supports($0) })
            }
            if region == .us, !visibleLayers.contains(.sectional) {
                // Back in the US: restore the default overlays dropped while abroad.
                visibleLayers.formUnion([.sectional, .tfrs])
            }
        }
    }

    // MARK: - Map State

    var mapCenter: CLLocationCoordinate2D = .init(latitude: 39.0, longitude: -98.0)  // CONUS center
    var mapZoom: Double = 5.0  // CONUS zoom level
    /// Visible map box, set (debounced) with the camera. Drives the layer panel's offline status.
    var mapVisibleBounds: OfflineRegionBounds?
    var mapMode: MapMode = .northUp
    var mapStyle: MapStyle = .vfrSectional
    /// TFRs are on by default: the proximity alert only runs while the layer is visible, and a
    /// TFR is the one hazard the sectional cannot show.
    var visibleLayers: Set<MapLayer> = [.sectional, .airports, .ownship, .tfrs]
    var sectionalOpacity: Double = 0.70  // 70% default per user decision
    /// Day / night / auto display mode (F16). Persisted; `auto` follows the sun at ownship, else the system.
    var displayMode: DisplayMode = DisplayMode(
        rawValue: UserDefaults.standard.string(forKey: DisplayMode.defaultsKey) ?? ""
    ) ?? .auto {
        didSet { UserDefaults.standard.set(displayMode.rawValue, forKey: DisplayMode.defaultsKey) }
    }

    // MARK: - Location / Ownship State

    var ownshipPosition: CLLocation?
    var groundSpeed: Double = 0        // knots
    var altitude: Double = 0           // feet MSL
    var verticalSpeed: Double = 0      // feet per minute
    var track: Double = 0              // degrees true
    var gpsAvailable: Bool = false
    var gpsFailure: GPSFailureReason?  // why no position is coming; nil once a fix arrives
    var gpsStationary: Bool = false    // CoreLocation paused updates (device still); last fix stays valid
    var firstLocationReceived: Bool = false  // prevents re-animation after initial GPS fix

    // MARK: - Flight Plan State (for instrument strip DTG/ETE)

    var activeFlightPlan: Bool = false
    var distanceToNext: Double?        // nautical miles
    var estimatedTimeEnroute: TimeInterval?  // seconds
    var bearingToNext: Double?         // degrees true, ownship to the next waypoint
    /// Predicted airspace entries ahead (Direction 2 stage 2), soonest first; empty when predictions
    /// are off, the fix is stale, or nothing is ahead. Written by PredictionService on each fix.
    var predictedEvents: [PredictedEvent] = []
    var directToAirport: Airport?
    var activePlanDeparture: String?     // ICAO of departure for summary card
    var activePlanDestination: String?   // ICAO of destination for summary card
    var activePlanDestinationCoordinate: CLLocationCoordinate2D?  // destination of a US direct plan, for live DTG/ETE
    var activePlanFuelGallons: Double?   // Estimated fuel for summary card
    /// Activated multi-leg route (Israel CVFR plan); nil for US direct plans and Direct-To.
    var activeRoute: ActiveRoute?

    // MARK: - Profile State

    var activeAircraftProfileID: UUID?
    var activePilotProfileID: UUID?

    // MARK: - Recording State

    var recordingStatus: RecordingStatus = .idle
    var currentFlightPhase: FlightPhaseType = .preflight
    var recordingElapsedTime: TimeInterval = 0
    var recentTranscripts: [TranscriptDisplayItem] = []  // last 5 for live panel
    var audioLevel: Float = -160  // dBFS for level meter
    var isAutoStartEnabled: Bool = true
    var autoStartSpeedThresholdKts: Double = 15.0  // knots, user configurable
    var activeFlightRecordID: UUID?

    // MARK: - Shared Services

    /// The single aviation database service for the whole app. Set by
    /// `getOrCreateDatabaseService()`; nil until the first caller asks for it.
    /// When the database failed to open this holds an `UnavailableDatabaseService`
    /// (every query throws) and `databaseError` explains why.
    private(set) var sharedDatabaseService: (any DatabaseServiceProtocol)?

    /// Why the aviation database could not be opened. Drives the non-dismissable
    /// "Airport database unavailable" banner. nil when the database is healthy.
    private(set) var databaseError: EFBError?

    var sharedMapService: MapService?

    /// Open the aviation database once and share it. Never falls back to an empty
    /// placeholder: on failure it records `databaseError` and returns a service whose
    /// queries throw, so no view can mistake a broken database for "no airports".
    ///
    /// Launch with `-simulateDatabaseFailure YES` (debug builds only) to exercise the
    /// failure path in UI tests.
    @discardableResult
    func getOrCreateDatabaseService(
        make: () throws -> any DatabaseServiceProtocol = { try DatabaseManager() }
    ) -> any DatabaseServiceProtocol {
        if let existing = sharedDatabaseService {
            return existing
        }
        do {
            #if DEBUG
            if UserDefaults.standard.bool(forKey: "simulateDatabaseFailure") {
                throw EFBError.databaseCorrupted
            }
            #endif
            let service = try make()
            sharedDatabaseService = service
            databaseError = nil
            return service
        } catch let error as EFBError {
            return recordDatabaseFailure(error)
        } catch {
            return recordDatabaseFailure(.databaseMigrationFailed(underlying: error))
        }
    }

    private func recordDatabaseFailure(_ error: EFBError) -> any DatabaseServiceProtocol {
        let unavailable = UnavailableDatabaseService()
        sharedDatabaseService = unavailable
        databaseError = error
        return unavailable
    }

    // MARK: - Shared Recording Database

    /// The single RecordingDatabase for the whole app (recording, replay, debrief).
    /// Initialized lazily on first access; creation is attempted once per launch.
    private(set) var sharedRecordingDatabase: RecordingDatabase?

    /// Why the recording database could not be opened, if `getOrCreateRecordingDatabase()` returned nil.
    private(set) var recordingDatabaseError: EFBError?

    func getOrCreateRecordingDatabase() -> RecordingDatabase? {
        if let existing = sharedRecordingDatabase {
            return existing
        }
        guard recordingDatabaseError == nil else { return nil }  // already failed this launch
        do {
            let db = try RecordingDatabase()
            sharedRecordingDatabase = db
            return db
        } catch let error as EFBError {
            recordingDatabaseError = error
        } catch {
            recordingDatabaseError = .databaseMigrationFailed(underlying: error)
        }
        return nil
    }

    // MARK: - Currency Warning State

    /// User dismissed currency warning banner for this session.
    var currencyWarningDismissed: Bool = false

    // MARK: - System State

    var networkAvailable: Bool = false
    var batteryLevel: Double = 1.0
    var powerState: PowerState = .normal

    // MARK: - Init

    init() {
        // Default init -- services will be wired in later plans
    }
}
