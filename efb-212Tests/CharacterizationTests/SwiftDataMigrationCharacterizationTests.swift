//
//  SwiftDataMigrationCharacterizationTests.swift
//  efb-212Tests
//
//  Characterization: pins what the SwiftData schema, migration plan and on-disk store do.
//  A store written the way earlier builds opened it (bare `ModelContainer(for:)`, no migration
//  plan) must reopen through `EFBModelContainer` (versioned schema + migration plan), and the
//  reverse, so the first real SchemaV2 migration starts from a store the plan recognises.
//  efb-lrq: the app now builds its one container with `EFBModelContainer.makeForApp()`.
//

import Testing
import Foundation
import SwiftData
@testable import efb_212

@Suite("SwiftData Migration Characterization", .serialized)
@MainActor
struct SwiftDataMigrationCharacterizationTests {

    /// Keeps reopened containers alive for the duration of the run (contexts hold them weakly).
    nonisolated(unsafe) static var containers: [ModelContainer] = []

    static let start = Date(timeIntervalSince1970: 1_793_332_020)
    static let flightID = UUID()
    static let aircraftID = UUID()
    static let pilotID = UUID()
    static let planID = UUID()

    // MARK: - Helpers

    /// Unique temp directory and the store URL inside it.
    static func makeStoreLocation() throws -> (dir: URL, store: URL) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("efb-swiftdata-char-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return (dir, dir.appendingPathComponent("efb.store"))
    }

    /// Container built exactly like efb_212App (same six types, default options) but on disk at `store`.
    static func makeAppStyleContainer(at store: URL) throws -> ModelContainer {
        try ModelContainer(
            for: SchemaV1.UserSettings.self,
            SchemaV1.AircraftProfile.self,
            SchemaV1.PilotProfile.self,
            SchemaV1.FlightPlanRecord.self,
            SchemaV1.FlightRecord.self,
            SchemaV1.LogbookEntry.self,
            configurations: ModelConfiguration(url: store)
        )
    }

    /// Container built through the versioned schema and the migration plan.
    static func makeVersionedContainer(at store: URL) throws -> ModelContainer {
        try ModelContainer(
            for: Schema(versionedSchema: SchemaV1.self),
            migrationPlan: EFBSchemaMigrationPlan.self,
            configurations: ModelConfiguration(url: store)
        )
    }

    /// Insert one row of every model type and save, then let the writer container go.
    static func seedStore(at store: URL) throws {
        let container = try makeAppStyleContainer(at: store)
        let context = ModelContext(container)

        let settings = SchemaV1.UserSettings()
        settings.activeAircraftID = aircraftID.uuidString
        settings.region = .us                      // an existing install's stored choice survives the Israel default
        context.insert(settings)

        let aircraft = SchemaV1.AircraftProfile(nNumber: "N12345")
        aircraft.id = aircraftID
        aircraft.aircraftType = "C172"
        aircraft.fuelCapacityGallons = 56          // US gallons
        aircraft.isActive = true
        context.insert(aircraft)

        let pilot = SchemaV1.PilotProfile()
        pilot.id = pilotID
        pilot.name = "Test Pilot"
        pilot.totalHours = 123.4                   // hours
        context.insert(pilot)

        let plan = SchemaV1.FlightPlanRecord()
        plan.id = planID
        plan.departureICAO = "KPAO"
        plan.destinationICAO = "KSQL"
        plan.cruiseAltitude = 4500                 // feet MSL
        context.insert(plan)

        let flight = SchemaV1.FlightRecord()
        flight.id = flightID
        flight.startDate = start
        flight.endDate = start.addingTimeInterval(1800)
        flight.trackPointCount = 1800
        flight.audioFileURL = "recordings/\(flightID.uuidString).m4a"   // stored relative to Application Support
        context.insert(flight)

        let entry = SchemaV1.LogbookEntry()
        entry.flightID = flightID
        entry.isConfirmed = true
        entry.durationSeconds = 1800               // seconds
        context.insert(entry)

        try context.save()
    }

    /// Assert every seeded row survived in `container`.
    static func expectSeededRows(in container: ModelContainer) throws {
        let context = ModelContext(container)

        let settings = try context.fetch(FetchDescriptor<SchemaV1.UserSettings>())
        #expect(settings.count == 1)
        let setting = try #require(settings.first)
        #expect(setting.activeAircraftID == aircraftID.uuidString)
        #expect(setting.defaultMapMode == "northUp")
        #expect(setting.sectionalOpacity == 0.70)
        #expect(setting.weatherRefreshInterval == 900)
        #expect(setting.regionRaw == "us")

        let aircraft = try context.fetch(FetchDescriptor<SchemaV1.AircraftProfile>())
        #expect(aircraft.count == 1)
        #expect(aircraft.first?.id == aircraftID)
        #expect(aircraft.first?.nNumber == "N12345")
        #expect(aircraft.first?.fuelCapacityGallons == 56)
        #expect(aircraft.first?.isActive == true)

        let pilots = try context.fetch(FetchDescriptor<SchemaV1.PilotProfile>())
        #expect(pilots.count == 1)
        #expect(pilots.first?.id == pilotID)
        #expect(pilots.first?.name == "Test Pilot")
        #expect(pilots.first?.totalHours == 123.4)

        let plans = try context.fetch(FetchDescriptor<SchemaV1.FlightPlanRecord>())
        #expect(plans.count == 1)
        #expect(plans.first?.id == planID)
        #expect(plans.first?.destinationICAO == "KSQL")
        #expect(plans.first?.cruiseAltitude == 4500)

        let flights = try context.fetch(FetchDescriptor<SchemaV1.FlightRecord>())
        #expect(flights.count == 1)
        let flight = try #require(flights.first)
        #expect(flight.id == flightID)
        #expect(flight.startDate == start)
        #expect(flight.trackPointCount == 1800)
        #expect(flight.audioFileURL == "recordings/\(flightID.uuidString).m4a")

        let entries = try context.fetch(FetchDescriptor<SchemaV1.LogbookEntry>())
        #expect(entries.count == 1)
        #expect(entries.first?.flightID == flightID)
        #expect(entries.first?.isConfirmed == true)
    }

    // MARK: - Schema and plan

    @Test func migrationPlanHasOnlySchemaV1AndNoStages() {
        let schemas = EFBSchemaMigrationPlan.schemas
        #expect(schemas.count == 1)
        #expect(schemas.first.map { ObjectIdentifier($0) } == ObjectIdentifier(SchemaV1.self))
        #expect(EFBSchemaMigrationPlan.stages.isEmpty)
        #expect(SchemaV1.versionIdentifier == Schema.Version(1, 0, 0))
    }

    @Test func schemaV1ListsTheSixModelTypesTheAppRegisters() {
        // SchemaV1.models is the only model list; EFBModelContainer builds the app container from it.
        let expected: Set<ObjectIdentifier> = [
            ObjectIdentifier(SchemaV1.UserSettings.self),
            ObjectIdentifier(SchemaV1.AircraftProfile.self),
            ObjectIdentifier(SchemaV1.PilotProfile.self),
            ObjectIdentifier(SchemaV1.FlightPlanRecord.self),
            ObjectIdentifier(SchemaV1.FlightRecord.self),
            ObjectIdentifier(SchemaV1.LogbookEntry.self),
        ]
        #expect(SchemaV1.models.count == 6)
        #expect(Set(SchemaV1.models.map { ObjectIdentifier($0) }) == expected)
    }

    // MARK: - UserSettings defaults

    @Test func userSettingsStoredDefaults() {
        let settings = SchemaV1.UserSettings()
        #expect(settings.defaultMapMode == "northUp")
        #expect(settings.sectionalOpacity == 0.70)          // 0...1 overlay opacity
        #expect(settings.weatherRefreshInterval == 900)     // seconds (15 min)
        #expect(settings.activeAircraftID == nil)
        #expect(settings.activePilotID == nil)
        #expect(settings.lastFlightPlanID == nil)
        #expect(settings.regionRaw == "israel")             // IL-DEFAULT: a fresh record starts in Israel
        #expect(settings.region == .israel)
    }

    @Test func userSettingsUnknownRegionRawReadsAsDefaultAndSetterWritesRaw() {
        let settings = SchemaV1.UserSettings()
        settings.regionRaw = "atlantis"
        #expect(settings.region == Region.defaultRegion)
        #expect(settings.regionRaw == "atlantis")   // the getter does not repair the stored value
        settings.region = .israel
        #expect(settings.regionRaw == "israel")
    }

    // MARK: - On-disk round trip

    @Test func appStyleStoreReopensWithTheSameAppStyleContainer() throws {
        let location = try Self.makeStoreLocation()
        defer { try? FileManager.default.removeItem(at: location.dir) }

        try Self.seedStore(at: location.store)
        #expect(FileManager.default.fileExists(atPath: location.store.path))

        let reopened = try Self.makeAppStyleContainer(at: location.store)
        Self.containers.append(reopened)
        try Self.expectSeededRows(in: reopened)
    }

    @Test func appStyleStoreReopensThroughVersionedSchemaAndMigrationPlan() throws {
        let location = try Self.makeStoreLocation()
        defer { try? FileManager.default.removeItem(at: location.dir) }

        try Self.seedStore(at: location.store)

        // Stores written before the factory existed (bare ModelContainer(for:), no plan) must
        // reopen through the plan without losing rows.
        let reopened = try Self.makeVersionedContainer(at: location.store)
        Self.containers.append(reopened)
        try Self.expectSeededRows(in: reopened)
    }

    @Test func legacyStoreReopensThroughTheAppContainerFactory() throws {
        let location = try Self.makeStoreLocation()
        defer { try? FileManager.default.removeItem(at: location.dir) }

        try Self.seedStore(at: location.store)

        // efb-lrq: the app's factory opens the store the previous build wrote, rows intact.
        let reopened = try EFBModelContainer.make(url: location.store)
        Self.containers.append(reopened)
        try Self.expectSeededRows(in: reopened)
    }

    @Test func factoryStoreReopensWithTheLegacyStyleContainer() throws {
        let location = try Self.makeStoreLocation()
        defer { try? FileManager.default.removeItem(at: location.dir) }

        do {
            let writer = try EFBModelContainer.make(url: location.store)
            let context = ModelContext(writer)
            context.insert(SchemaV1.AircraftProfile(nNumber: "N12345"))
            try context.save()
        }

        // Rolling back to an older build (bare container) must still read what the factory wrote.
        let reopened = try Self.makeAppStyleContainer(at: location.store)
        Self.containers.append(reopened)
        let aircraft = try ModelContext(reopened).fetch(FetchDescriptor<SchemaV1.AircraftProfile>())
        #expect(aircraft.map(\.nNumber) == ["N12345"])
    }

    @Test func inMemoryFactoryContainerRegistersEverySchemaV1Model() throws {
        let container = try EFBModelContainer.make(inMemory: true)
        Self.containers.append(container)
        let registered = Set(container.schema.entities.map(\.name))
        #expect(registered == Set(["UserSettings", "AircraftProfile", "PilotProfile", "FlightPlanRecord", "FlightRecord", "LogbookEntry"]))
    }
}
