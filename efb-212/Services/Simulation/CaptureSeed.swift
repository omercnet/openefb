//
//  CaptureSeed.swift
//  efb-212
//
//  DEBUG only. The data the SwiftUI reference captures show (tools/ci/capture-screens.sh), so the React Native
//  fixtures can match it. Launch argument, read like the other hooks:
//    -OpenEFBSeed capture-fresh   a fresh install in Israel: region Israel, no pilot, no aircraft, nothing else
//    -OpenEFBSeed capture         Israel, aircraft N172KF (active) / N28PA / 4X-ABC, pilot "Test Pilot", one recorded
//                                 flight LLHA -> LLMG, a signed and a draft logbook entry
//  Dates are offsets from the start of today (UTC) of the run, because the currency rules compare with the real clock:
//  the dates and day counts the screens show move with the run date, the layout does not.
//  Unlike -OpenEFBSeed small|full (the importer fixtures, SeedDataHook) it writes no UserDefaults and no Keychain.
//

#if DEBUG

import Foundation
import SwiftData
import Security
import GRDB

enum CaptureSeed {
    static let profiles: Set<String> = ["capture", "capture-fresh"]

    private static func today(_ now: Date) -> Date {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return cal.startOfDay(for: now)
    }

    private static func uuid(_ kind: Int, _ n: Int) -> UUID {
        UUID(uuidString: String(format: "%08lX-0000-4000-8000-%012lX", 0xCA00 + kind, n))!
    }

    @MainActor
    static func run(
        profile: String, container: ModelContainer, now: Date = Date(),
        recordingDB: RecordingDatabase? = nil, audioDirectory: URL = FlightRecoveryService.defaultAudioDirectory
    ) throws {
        let context = container.mainContext
        try context.delete(model: SchemaV1.UserSettings.self)
        try context.delete(model: SchemaV1.AircraftProfile.self)
        try context.delete(model: SchemaV1.PilotProfile.self)
        try context.delete(model: SchemaV1.FlightPlanRecord.self)
        try context.delete(model: SchemaV1.FlightRecord.self)
        try context.delete(model: SchemaV1.LogbookEntry.self)
        let base = today(now)
        func day(_ n: Int, hour: Int = 0) -> Date { base.addingTimeInterval(Double(n) * 86_400 + Double(hour) * 3_600) }

        let settings = SchemaV1.UserSettings()
        settings.region = .israel
        settings.createdAt = day(-300)
        if profile == "capture" {
            settings.activeAircraftID = uuid(1, 1).uuidString
            settings.activePilotID = uuid(2, 1).uuidString
        }
        context.insert(settings)
        let db = try recordingDB ?? RecordingDatabase()
        try clearRecordings(db: db, audioDirectory: audioDirectory)
        // A NOTAM credential left by -OpenEFBSeed small|full must not show in the fresh install.
        let store = KeychainStore(service: "quartermint.efb-212.faa-notam-api")
        for account in ["client_id", "client_secret"] {
            do { try store.removeValue(forAccount: account) } catch KeychainError.unexpectedStatus(errSecMissingEntitlement) {
                // The unit-test host has no Keychain entitlement, so no credential can have been stored there.
            }
        }
        guard profile == "capture" else { try context.save(); return }

        for (i, n) in ["N172KF", "N28PA", "4X-ABC"].enumerated() {
            let a = SchemaV1.AircraftProfile(nNumber: n)
            a.id = uuid(1, i + 1)
            a.isActive = i == 0
            a.createdAt = day(-200 + i)
            if i == 0 {
                a.aircraftType = "C172S"
                a.icaoTypeDesignator = "C172"
                a.fuelCapacityGallons = 53
                a.fuelBurnGPH = 9
                a.cruiseSpeedKts = 110
                a.personsOnBoard = 2
                a.annualDue = day(120)
                a.transponderDue = day(200)
                a.vSpeeds = VSpeeds(vr: 55, vx: 62, vy: 74, va: 99, vne: 163, vfe: 85, vs0: 40, vs1: 48)
            } else if i == 1 {
                a.aircraftType = "PA28"
            }
            context.insert(a)
        }

        let pilot = SchemaV1.PilotProfile()
        pilot.id = uuid(2, 1)
        pilot.name = "Test Pilot"
        pilot.certificateType = CertificateType.privatePilot.rawValue
        pilot.medicalClass = MedicalClass.third.rawValue
        pilot.medicalExpiry = day(20)
        pilot.flightReviewDate = day(-200)
        pilot.totalHours = 412.5
        pilot.isActive = true
        pilot.nightLandingEntries = [SchemaV1.NightLandingEntry(date: day(-30), count: 1),
                                     SchemaV1.NightLandingEntry(date: day(-45), count: 1)]
        pilot.createdAt = day(-300)
        context.insert(pilot)

        let flightID = uuid(3, 1)
        let flight = SchemaV1.FlightRecord()
        flight.id = flightID
        flight.startDate = day(-1, hour: 8)
        flight.endDate = day(-1, hour: 8).addingTimeInterval(900)
        flight.departureICAO = "LLHA"; flight.departureName = "Haifa"
        flight.arrivalICAO = "LLMG"; flight.arrivalName = "Megiddo"
        flight.durationSeconds = 900
        flight.audioQuality = "standard"
        flight.trackPointCount = trackPoints
        flight.transcriptSegmentCount = 6
        flight.aircraftProfileID = uuid(1, 1).uuidString
        flight.pilotProfileID = uuid(2, 1).uuidString
        flight.createdAt = flight.startDate
        context.insert(flight)

        let signed = SchemaV1.LogbookEntry()
        signed.id = uuid(4, 1)
        signed.date = day(-10)
        signed.departureICAO = "LLIB"; signed.departureName = "Rosh Pina"
        signed.arrivalICAO = "LLHZ"; signed.arrivalName = "Herzliya"
        signed.durationSeconds = 5_040
        signed.aircraftProfileID = uuid(1, 1).uuidString
        signed.aircraftType = "C172S"
        signed.pilotProfileID = uuid(2, 1).uuidString
        signed.dayLandingCount = 1
        signed.nightLandingCount = 1
        signed.notes = "Smooth air, a little haze on the coast."
        signed.isConfirmed = true
        signed.createdAt = signed.date
        context.insert(signed)

        let draft = SchemaV1.LogbookEntry()
        draft.id = uuid(4, 2)
        draft.flightID = flightID
        draft.date = flight.startDate
        draft.departureICAO = "LLHA"; draft.departureName = "Haifa"
        draft.arrivalICAO = "LLMG"; draft.arrivalName = "Megiddo"
        draft.durationSeconds = 900
        draft.aircraftProfileID = uuid(1, 1).uuidString
        draft.aircraftType = "C172S"
        draft.pilotProfileID = uuid(2, 1).uuidString
        draft.dayLandingCount = 1
        draft.isConfirmed = false
        draft.createdAt = flight.startDate
        context.insert(draft)
        try context.save()

        try seedRecording(db: db, flightID: flightID, start: flight.startDate)
    }

    /// Drops every recorded flight and the audio files, so FlightRecoveryService has no orphan to restore as a flight.
    private static func clearRecordings(db: RecordingDatabase, audioDirectory dir: URL) throws {
        for id in try db.flightIDsWithRecordedData() { try db.deleteFlightData(flightID: id) }
        // A missing directory is fine; any other failure stops the seed rather than leaving audio recovery would restore.
        guard FileManager.default.fileExists(atPath: dir.path) else { return }
        let files = try FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)
        for file in files where file.pathExtension == "m4a" { try FileManager.default.removeItem(at: file) }
    }

    static let trackPoints = 900

    /// LLHA -> LLMG in a straight line at 1 Hz: climb, cruise, descent; six transcript lines; no AI debrief.
    private static func seedRecording(db: RecordingDatabase, flightID: UUID, start: Date) throws {
        try db.dbPool.write { dbc in
            for i in 0..<trackPoints {
                let f = Double(i) / Double(trackPoints - 1)
                let point = TrackPointRecord(
                    id: uuid(5, i), flightID: flightID, timestamp: start.addingTimeInterval(Double(i)),
                    latitude: 32.8094 + (32.5978 - 32.8094) * f, longitude: 35.0431 + (35.2292 - 35.0431) * f,
                    altitudeFeet: 1_500 * min(1, min(f * 6, (1 - f) * 6)), groundSpeedKnots: 95,
                    verticalSpeedFPM: f < 0.17 ? 500 : (f > 0.83 ? -500 : 0), courseDegrees: 135)
                try point.insert(dbc)
            }
        }
        let lines = ["Haifa tower, Charlie Foxtrot, ready for departure.", "Cleared for takeoff.",
                     "Departing the zone to the south east.", "Passing Kishon, 1500.",
                     "Megiddo traffic, inbound for landing.", "Landing."]
        for (i, text) in lines.enumerated() {
            try db.insertTranscript(TranscriptSegmentRecord(
                id: uuid(6, i), flightID: flightID, timestamp: start.addingTimeInterval(Double(i) * 150),
                text: text, confidence: 0.9, audioStartTime: Double(i) * 150, audioEndTime: Double(i) * 150 + 5,
                flightPhase: FlightPhaseType.allCases[i % FlightPhaseType.allCases.count].rawValue))
        }
        try db.saveRouteLegs([(from: "LLHA", to: "LLMG")], forFlight: flightID)
    }
}

#endif
