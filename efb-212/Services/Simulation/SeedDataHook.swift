//
//  SeedDataHook.swift
//  efb-212
//
//  DEBUG only. Writes a deterministic, fictional data set through the app's own persistence (the default SwiftData
//  store, the GRDB recording database, UserDefaults, the Keychain) so tools/ci/make-fixtures.sh can collect the real
//  on-disk files. They are the ground truth the React Native importer is built and tested against.
//
//  Launch argument (read from UserDefaults like the other hooks):
//    -OpenEFBSeed full|small     full: 3,600 track points on the recorded flight; small: 300 (for the checked-in fixture)
//  Writes Documents/seed-report.json when done (paths, counts, UserDefaults and Keychain item attributes, no values of
//  secrets). Existing rows of the six model types and the recording database are replaced, so running it twice gives
//  the same store. No personal data: names, numbers and mail addresses are made up.
//

#if DEBUG

import Foundation
import SwiftData
import GRDB
import Security
import OSLog

enum SeedDataHook {
    static let seedKey = "OpenEFBSeed"
    private static let log = Logger(subsystem: "io.omer.efb", category: "SeedData")

    /// 2025-01-01T00:00:00Z: every date in the data set is an offset from it.
    private static let base = Date(timeIntervalSince1970: 1_735_689_600)
    private static func day(_ n: Int, hour: Int = 0) -> Date { base.addingTimeInterval(Double(n) * 86_400 + Double(hour) * 3_600) }

    /// Stable ids: the kind in the first group, the index in the last.
    private static func uuid(_ kind: Int, _ n: Int) -> UUID {
        UUID(uuidString: String(format: "%08lX-0000-4000-8000-%012lX", kind, n))!
    }
    private enum Kind { static let aircraft = 1, pilot = 2, plan = 3, flight = 4, logbook = 5, record = 6 }

    @MainActor
    static func runIfRequested(container: ModelContainer, defaults: UserDefaults = .standard) {
        guard let profile = defaults.string(forKey: seedKey) else { return }
        guard profile == "small" || profile == "full" else {
            log.error("Unknown -OpenEFBSeed profile: \(profile, privacy: .public) (use small or full)")
            let message = "unknown profile '\(profile)'; use small or full".replacingOccurrences(of: "\"", with: "'")
            try? "{\"error\": \"\(message)\"}".write(to: reportURL, atomically: true, encoding: .utf8)
            return
        }
        let trackPoints = profile == "small" ? 300 : 3_600
        do {
            try seedSwiftData(container.mainContext, trackPoints: trackPoints)
            try seedRecording(trackPoints: trackPoints)
            seedDefaults(defaults)
            let keychainWrites = seedKeychain()
            try writeReport(container: container, profile: profile, trackPoints: trackPoints, keychainWrites: keychainWrites)
            log.notice("Seed data written (\(profile, privacy: .public))")
        } catch {
            log.error("Seed failed: \(String(describing: error), privacy: .public)")
            try? "{\"error\": \"\(String(describing: error).replacingOccurrences(of: "\"", with: "'"))\"}"
                .write(to: reportURL, atomically: true, encoding: .utf8)
        }
    }

    // MARK: - SwiftData

    @MainActor
    private static func seedSwiftData(_ context: ModelContext, trackPoints: Int) throws {
        try context.delete(model: SchemaV1.UserSettings.self)
        try context.delete(model: SchemaV1.AircraftProfile.self)
        try context.delete(model: SchemaV1.PilotProfile.self)
        try context.delete(model: SchemaV1.FlightPlanRecord.self)
        try context.delete(model: SchemaV1.FlightRecord.self)
        try context.delete(model: SchemaV1.LogbookEntry.self)

        let settings = SchemaV1.UserSettings()
        settings.defaultMapMode = "trackUp"
        settings.sectionalOpacity = 0.55
        settings.weatherRefreshInterval = 600
        settings.activeAircraftID = uuid(Kind.aircraft, 1).uuidString
        settings.activePilotID = uuid(Kind.pilot, 1).uuidString
        settings.lastFlightPlanID = uuid(Kind.plan, 2).uuidString
        settings.region = .us
        settings.createdAt = day(0)
        context.insert(settings)

        // 3 aircraft: full V-speeds, partial V-speeds, none; optionals both set and nil.
        let types = ["C172S", "PA28", "SR22"]
        for i in 1...3 {
            let a = SchemaV1.AircraftProfile(nNumber: "N\(i)00KF")
            a.id = uuid(Kind.aircraft, i)
            a.aircraftType = types[i - 1]
            a.isActive = i == 1
            a.createdAt = day(i)
            if i != 3 {
                a.fuelCapacityGallons = 53 + Double(i)
                a.fuelBurnGPH = 8.5 + Double(i)
                a.cruiseSpeedKts = 110 + Double(i) * 5
                a.icaoTypeDesignator = types[i - 1]
                a.personsOnBoard = i + 1
                a.annualDue = day(300 + i)
                a.transponderDue = day(200 + i)
            }
            if i == 1 {
                a.vSpeeds = VSpeeds(vr: 55, vx: 62, vy: 74, va: 99, vne: 163, vfe: 85, vs0: 40, vs1: 48)
            } else if i == 2 {
                a.vSpeeds = VSpeeds(vr: nil, vx: nil, vy: 79, va: nil, vne: 148, vfe: nil, vs0: 44, vs1: nil)
            }
            context.insert(a)
        }

        // 2 pilots: full profile with night landings, sparse profile.
        let p1 = SchemaV1.PilotProfile()
        p1.id = uuid(Kind.pilot, 1)
        p1.name = "Test Pilot One"
        p1.certificateNumber = "SEED-0001"
        p1.phone = "+1 555 0100"
        p1.email = "pilot1@example.invalid"
        p1.certificateType = CertificateType.privatePilot.rawValue
        p1.medicalClass = MedicalClass.third.rawValue
        p1.medicalExpiry = day(400)
        p1.flightReviewDate = day(120)
        p1.totalHours = 412.5
        p1.isActive = true
        p1.nightLandingEntries = [SchemaV1.NightLandingEntry(date: day(30), count: 2),
                                  SchemaV1.NightLandingEntry(date: day(45), count: 1)]
        p1.createdAt = day(0)
        context.insert(p1)
        let p2 = SchemaV1.PilotProfile()
        p2.id = uuid(Kind.pilot, 2)
        p2.name = "Test Pilot Two"
        p2.createdAt = day(1)
        context.insert(p2)

        // 5 plans: Israel and US routes.
        let airports: [(String, String, Double, Double)] = [
            ("LLHZ", "Herzliya", 32.1800, 34.8333), ("LLIB", "Rosh Pina", 32.9811, 35.5719),
            ("KPAO", "Palo Alto", 37.4611, -122.1150), ("KSQL", "San Carlos", 37.5119, -122.2494),
            ("LLBS", "Beer Sheva Teyman", 31.2870, 34.7230), ("LLRS", "Ein Yahav", 30.6212, 35.2038)
        ]
        let routes = [(0, 1), (2, 3), (1, 0), (4, 5), (3, 2)]
        for (n, route) in routes.enumerated() {
            let from = airports[route.0], to = airports[route.1]
            let plan = SchemaV1.FlightPlanRecord()
            plan.id = uuid(Kind.plan, n + 1)
            plan.name = n % 2 == 0 ? "\(from.0) to \(to.0)" : nil
            plan.departureICAO = from.0; plan.departureName = from.1
            plan.departureLatitude = from.2; plan.departureLongitude = from.3
            plan.destinationICAO = to.0; plan.destinationName = to.1
            plan.destinationLatitude = to.2; plan.destinationLongitude = to.3
            plan.cruiseAltitude = 2500 + 500 * n
            plan.cruiseSpeedKts = 100 + Double(n) * 5
            plan.fuelBurnGPH = n % 2 == 0 ? 9.5 : nil
            plan.totalDistanceNM = 40 + Double(n) * 12.5
            plan.estimatedTimeSeconds = 1_500 + Double(n) * 420
            plan.estimatedFuelGallons = n % 2 == 0 ? 4.25 : nil
            plan.notes = n == 0 ? "Seed plan, \u{05E9}\u{05DC}\u{05D5}\u{05DD} unicode check" : nil
            plan.lastUsedAt = day(60 + n)
            plan.createdAt = day(50 + n)
            context.insert(plan)
        }

        // 10 flights; flight 1 is the one with recorded data in recording.sqlite.
        for i in 1...10 {
            let f = SchemaV1.FlightRecord()
            f.id = uuid(Kind.flight, i)
            f.startDate = day(70 + i, hour: 8)
            f.endDate = i == 10 ? nil : day(70 + i, hour: 9)
            f.departureICAO = i % 3 == 0 ? nil : "LLHZ"
            f.arrivalICAO = i % 3 == 0 ? nil : "LLIB"
            f.departureName = i % 3 == 0 ? nil : "Herzliya"
            f.arrivalName = i % 3 == 0 ? nil : "Rosh Pina"
            f.durationSeconds = i == 10 ? 0 : 3_600
            f.audioFileURL = i == 1 ? "seed-audio-1.m4a" : nil
            f.audioQuality = i % 2 == 0 ? "high" : "standard"
            f.trackPointCount = i == 1 ? trackPoints : 0
            f.transcriptSegmentCount = i == 1 ? 12 : 0
            f.aircraftProfileID = uuid(Kind.aircraft, (i % 3) + 1).uuidString
            f.pilotProfileID = uuid(Kind.pilot, (i % 2) + 1).uuidString
            f.hasDebrief = i == 1
            f.notes = i == 10 ? SchemaV1.FlightRecord.recoveredNote : (i == 2 ? "Seed note" : nil)
            f.createdAt = day(70 + i, hour: 8)
            context.insert(f)
        }

        // 20 logbook rows: some linked to a flight, some manual.
        for i in 1...20 {
            let e = SchemaV1.LogbookEntry()
            e.id = uuid(Kind.logbook, i)
            e.flightID = i <= 10 ? uuid(Kind.flight, i) : nil
            e.date = day(70 + i)
            e.departureICAO = i % 4 == 0 ? nil : "KPAO"
            e.departureName = i % 4 == 0 ? nil : "Palo Alto"
            e.arrivalICAO = i % 4 == 0 ? nil : "KSQL"
            e.arrivalName = i % 4 == 0 ? nil : "San Carlos"
            e.route = i % 2 == 0 ? "KPAO KSQL" : nil
            e.durationSeconds = 1_800 + Double(i) * 60
            e.aircraftProfileID = uuid(Kind.aircraft, (i % 3) + 1).uuidString
            e.aircraftType = types[i % 3]
            e.pilotProfileID = uuid(Kind.pilot, (i % 2) + 1).uuidString
            e.nightLandingCount = i % 5 == 0 ? 2 : 0
            e.dayLandingCount = 1 + i % 3
            e.notes = i % 7 == 0 ? "Seed logbook note \(i)" : nil
            e.isConfirmed = i % 2 == 0
            e.hasDebrief = i == 1
            e.createdAt = day(70 + i)
            context.insert(e)
        }
        try context.save()
    }

    // MARK: - Recording database (GRDB)

    private static func seedRecording(trackPoints count: Int) throws {
        let db = try RecordingDatabase()
        for id in try db.flightIDsWithRecordedData() { try db.deleteFlightData(flightID: id) }
        let flightID = uuid(Kind.flight, 1)
        let start = day(71, hour: 8)

        // LLHZ -> LLIB in a straight line, 1 Hz, climb / cruise / descent.
        try db.dbPool.write { dbc in
            for i in 0..<count {
                let f = Double(i) / Double(max(count - 1, 1))
                let altitude = 2_500 * min(1, min(f * 8, (1 - f) * 8))
                let point = TrackPointRecord(
                    id: uuid(Kind.record, i), flightID: flightID, timestamp: start.addingTimeInterval(Double(i)),
                    latitude: 32.1800 + (32.9811 - 32.1800) * f, longitude: 34.8333 + (35.5719 - 34.8333) * f,
                    altitudeFeet: altitude, groundSpeedKnots: i % 50 == 0 ? 0 : 98 + Double(i % 7),
                    verticalSpeedFPM: f < 0.125 ? 500 : (f > 0.875 ? -500 : 0), courseDegrees: 37 + Double(i % 3) * 0.5)
                try point.insert(dbc)
            }
        }
        for i in 0..<12 {
            try db.insertTranscript(TranscriptSegmentRecord(
                id: uuid(Kind.record + 100, i), flightID: flightID, timestamp: start.addingTimeInterval(Double(i) * 60),
                text: "Seed transcript segment \(i)", confidence: i % 4 == 0 ? nil : 0.9 - Double(i) * 0.01,
                audioStartTime: Double(i) * 60, audioEndTime: Double(i) * 60 + 5,
                flightPhase: FlightPhaseType.allCases[i % FlightPhaseType.allCases.count].rawValue))
        }
        for (i, phase) in FlightPhaseType.allCases.enumerated() {
            try db.insertPhaseMarker(PhaseMarkerRecord(
                id: uuid(Kind.record + 200, i), flightID: flightID, phase: phase.rawValue,
                startTimestamp: start.addingTimeInterval(Double(i) * 400),
                endTimestamp: i == FlightPhaseType.allCases.count - 1 ? nil : start.addingTimeInterval(Double(i + 1) * 400),
                latitude: 32.18 + Double(i) * 0.1, longitude: 34.83 + Double(i) * 0.1))
        }
        try db.insertDebrief(DebriefRecord(
            id: uuid(Kind.record + 300, 0), flightID: flightID, narrativeSummary: "Seed debrief narrative.",
            phaseObservationsJSON: "[]", improvementsJSON: "[\"Seed improvement\"]", overallRating: 4,
            generatedAt: start.addingTimeInterval(4_000), promptTokensEstimate: 1_200, responseTokensEstimate: 300))
        try db.saveRouteLegs([(from: "LLHZ", to: "LLIB")], forFlight: flightID)
    }

    // MARK: - UserDefaults

    private static func seedDefaults(_ defaults: UserDefaults) {
        defaults.set(true, forKey: "hasSeenOnboarding")
        defaults.set("night", forKey: DisplayMode.defaultsKey)
        defaults.set(false, forKey: "telemetryEnabled")
        defaults.set(false, forKey: "showsFlightLog")
        defaults.set(false, forKey: "showsInstruments")
        defaults.set(true, forKey: "showsPredictions")
        defaults.set(true, forKey: "israelChartHintDismissed")
        defaults.set(false, forKey: "showAirportDiagrams")
        defaults.set(2.5, forKey: "israelOffRouteThresholdNM")
        defaults.set(["seed-notam-a", "seed-notam-b"], forKey: "israelNotamReadKeys")
        defaults.set("cvfr", forKey: "israel.routeNetwork." + uuid(Kind.aircraft, 1).uuidString)
        defaults.set("lsa", forKey: "israel.routeNetwork." + uuid(Kind.aircraft, 2).uuidString)
        defaults.synchronize()
    }

    // MARK: - Keychain (placeholder values, never real credentials)

    private static func seedKeychain() -> [String: String] {
        let store = KeychainStore(service: "quartermint.efb-212.faa-notam-api")
        var results: [String: String] = [:]
        for (account, value) in [("client_id", "SEED-PLACEHOLDER-ID"), ("client_secret", "SEED-PLACEHOLDER-SECRET")] {
            do {
                try store.setString(value, forAccount: account)
                results[account] = "ok"
            } catch {
                log.error("Keychain write failed for \(account, privacy: .public): \(String(describing: error), privacy: .public)")
                results[account] = "failed: \(String(describing: error))"
            }
        }
        return results
    }

    /// Attributes only (service, account, accessibility, access group); never the stored value.
    private static func keychainItems() -> [[String: String]] {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitAll
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let items = result as? [[String: Any]] else {
            return [["status": "\(status)"]]
        }
        return items.map { item in
            ["service": item[kSecAttrService as String] as? String ?? "",
             "account": item[kSecAttrAccount as String] as? String ?? "",
             "accessible": item[kSecAttrAccessible as String] as? String ?? "",
             "accessGroup": item[kSecAttrAccessGroup as String] as? String ?? ""]
        }
    }

    // MARK: - Report

    private static var reportURL: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("seed-report.json")
    }

    private static func jsonSafe(_ value: Any) -> Any {
        if JSONSerialization.isValidJSONObject([value]) { return value }
        if let data = value as? Data { return "data:\(data.count) bytes" }
        if let date = value as? Date { return "date:\(date.timeIntervalSince1970)" }
        return String(describing: value)
    }

    @MainActor
    private static func writeReport(container: ModelContainer, profile: String, trackPoints: Int, keychainWrites: [String: String]) throws {
        let fm = FileManager.default
        let appSupport = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        var files: [[String: Any]] = []
        if let walker = fm.enumerator(at: appSupport, includingPropertiesForKeys: [.fileSizeKey, .isRegularFileKey]) {
            for case let url as URL in walker {
                let values = try? url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
                guard values?.isRegularFile == true else { continue }
                files.append(["path": String(url.path.dropFirst(appSupport.path.count + 1)), "bytes": values?.fileSize ?? 0])
            }
        }
        files.sort { ($0["path"] as? String ?? "") < ($1["path"] as? String ?? "") }

        let bundleID = Bundle.main.bundleIdentifier ?? "io.omer.efb"
        let domain = UserDefaults.standard.persistentDomain(forName: bundleID) ?? [:]
        let context = container.mainContext
        let counts: [String: Int] = [
            "UserSettings": (try? context.fetchCount(FetchDescriptor<SchemaV1.UserSettings>())) ?? -1,
            "AircraftProfile": (try? context.fetchCount(FetchDescriptor<SchemaV1.AircraftProfile>())) ?? -1,
            "PilotProfile": (try? context.fetchCount(FetchDescriptor<SchemaV1.PilotProfile>())) ?? -1,
            "FlightPlanRecord": (try? context.fetchCount(FetchDescriptor<SchemaV1.FlightPlanRecord>())) ?? -1,
            "FlightRecord": (try? context.fetchCount(FetchDescriptor<SchemaV1.FlightRecord>())) ?? -1,
            "LogbookEntry": (try? context.fetchCount(FetchDescriptor<SchemaV1.LogbookEntry>())) ?? -1
        ]
        let report: [String: Any] = [
            "profile": profile,
            "bundleID": bundleID,
            "trackPoints": trackPoints,
            "swiftDataStoreURL": container.configurations.first?.url.path ?? "",
            "applicationSupport": appSupport.path,
            "applicationSupportFiles": files,
            "modelCounts": counts,
            "userDefaultsDomain": domain.mapValues { jsonSafe($0) },
            "keychainWrites": keychainWrites,
            "keychainItems": keychainItems()
        ]
        let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: reportURL, options: .atomic)
    }
}

#endif
