//
//  LogbookViewModelTests.swift
//  efb-212Tests
//
//  LogbookViewModel list loading/totals, manual entry defaults, the confirm-and-update-currency
//  bridge to the active PilotProfile (FAR 61.57 night landings), deletion, and duration
//  rounding. Recording-summary field mapping lives in LogbookEntryTests.
//

import Testing
import Foundation
import SwiftData
@testable import efb_212

@Suite("LogbookViewModel Tests")
@MainActor
struct LogbookViewModelTests {

    static func makeContext() throws -> ModelContext {
        let container = try ModelContainer(
            for: SchemaV1.LogbookEntry.self, SchemaV1.PilotProfile.self,
            configurations: ModelConfiguration(isStoredInMemoryOnly: true)
        )
        // Keep the container alive for the context's lifetime.
        Self.containers.append(container)
        return container.mainContext
    }

    nonisolated(unsafe) private static var containers: [ModelContainer] = []

    @discardableResult
    static func insertEntry(_ context: ModelContext, date: TimeInterval, duration: Double, nightLandings: Int = 0) -> SchemaV1.LogbookEntry {
        let entry = SchemaV1.LogbookEntry()
        entry.date = Date(timeIntervalSince1970: date)
        entry.durationSeconds = duration
        entry.nightLandingCount = nightLandings
        context.insert(entry)
        return entry
    }

    // MARK: - Loading and totals

    @Test func loadEntriesSortsMostRecentFirstAndSumsDuration() throws {
        let context = try Self.makeContext()
        Self.insertEntry(context, date: 1_700_000_000, duration: 3600)
        Self.insertEntry(context, date: 1_700_200_000, duration: 5400)
        Self.insertEntry(context, date: 1_700_100_000, duration: 1800)

        let vm = LogbookViewModel()
        vm.loadEntries(modelContext: context)

        #expect(vm.entries.map(\.date.timeIntervalSince1970) == [1_700_200_000, 1_700_100_000, 1_700_000_000])
        #expect(vm.totalFlights == 3)
        #expect(vm.totalFlightTimeSeconds == 10_800)
    }

    @Test func loadEntriesOnEmptyLogbookZeroesPreviousTotals() throws {
        let context = try Self.makeContext()
        let entry = Self.insertEntry(context, date: 1_700_000_000, duration: 3600)
        let vm = LogbookViewModel()
        vm.loadEntries(modelContext: context)
        #expect(vm.totalFlights == 1)

        vm.deleteEntry(entry, modelContext: context)
        vm.loadEntries(modelContext: context)

        #expect(vm.entries.isEmpty)
        #expect(vm.totalFlights == 0)
        #expect(vm.totalFlightTimeSeconds == 0)
    }

    // MARK: - Manual entry

    @Test func manualEntryIsUnconfirmedHasNoFlightIDAndIsDatedNow() throws {
        let context = try Self.makeContext()
        let vm = LogbookViewModel()

        let entry = vm.createManualEntry(modelContext: context)

        #expect(entry.flightID == nil)
        #expect(entry.isConfirmed == false)
        #expect(abs(entry.date.timeIntervalSinceNow) < 5)
        vm.loadEntries(modelContext: context)
        #expect(vm.entries.count == 1)   // inserted into the context, not just returned
    }

    // MARK: - Confirm + currency

    @Test func confirmWithNightLandingsAppendsToActivePilotOnly() throws {
        let context = try Self.makeContext()
        let active = SchemaV1.PilotProfile()
        active.isActive = true
        let inactive = SchemaV1.PilotProfile()
        inactive.isActive = false
        context.insert(active)
        context.insert(inactive)
        let entry = Self.insertEntry(context, date: 1_700_000_000, duration: 3600, nightLandings: 3)

        LogbookViewModel().confirmEntryAndUpdateCurrency(entry, modelContext: context)

        #expect(entry.isConfirmed)
        #expect(active.nightLandingEntries == [SchemaV1.NightLandingEntry(date: entry.date, count: 3)])
        #expect(inactive.nightLandingEntries.isEmpty)
    }

    @Test func confirmAccumulatesNightLandingsAcrossFlights() throws {
        let context = try Self.makeContext()
        let pilot = SchemaV1.PilotProfile()
        pilot.isActive = true
        context.insert(pilot)
        let first = Self.insertEntry(context, date: 1_700_000_000, duration: 3600, nightLandings: 1)
        let second = Self.insertEntry(context, date: 1_700_100_000, duration: 3600, nightLandings: 2)
        let vm = LogbookViewModel()

        vm.confirmEntryAndUpdateCurrency(first, modelContext: context)
        vm.confirmEntryAndUpdateCurrency(second, modelContext: context)

        #expect(pilot.nightLandingEntries.map(\.count) == [1, 2])
    }

    @Test func confirmWithoutNightLandingsLeavesPilotCurrencyUntouched() throws {
        let context = try Self.makeContext()
        let pilot = SchemaV1.PilotProfile()
        pilot.isActive = true
        context.insert(pilot)
        let entry = Self.insertEntry(context, date: 1_700_000_000, duration: 3600, nightLandings: 0)

        LogbookViewModel().confirmEntryAndUpdateCurrency(entry, modelContext: context)

        #expect(entry.isConfirmed)
        #expect(pilot.nightLandingEntries.isEmpty)
    }

    @Test func confirmWithNightLandingsAndNoActivePilotStillConfirmsEntry() throws {
        let context = try Self.makeContext()
        let entry = Self.insertEntry(context, date: 1_700_000_000, duration: 3600, nightLandings: 2)

        LogbookViewModel().confirmEntryAndUpdateCurrency(entry, modelContext: context)

        #expect(entry.isConfirmed)
    }

    // MARK: - Deletion

    @Test func deleteRemovesOnlyThatEntry() throws {
        let context = try Self.makeContext()
        let keep = Self.insertEntry(context, date: 1_700_000_000, duration: 3600)
        let drop = Self.insertEntry(context, date: 1_700_100_000, duration: 1800)
        let vm = LogbookViewModel()

        vm.deleteEntry(drop, modelContext: context)
        vm.loadEntries(modelContext: context)

        #expect(vm.entries.map(\.id) == [keep.id])
        #expect(vm.totalFlightTimeSeconds == 3600)
    }

    // MARK: - Duration formatting boundaries

    @Test func decimalHoursRoundHalfUpAtOneDecimal() {
        #expect(LogbookViewModel.formatDurationDecimal(2700) == "0.8")   // 0.75 h
        #expect(LogbookViewModel.formatDurationDecimal(2520) == "0.7")   // 0.70 h
        #expect(LogbookViewModel.formatDurationDecimal(36_000) == "10.0")
    }

    @Test func hoursMinutesTruncateSecondsAndRollOverAtSixtyMinutes() {
        #expect(LogbookViewModel.formatDurationHM(3599) == "0h 59m")   // 59 min 59 s is not an hour
        #expect(LogbookViewModel.formatDurationHM(3600) == "1h 0m")
        #expect(LogbookViewModel.formatDurationHM(150) == "0h 2m")
        #expect(LogbookViewModel.formatDurationHM(90_061) == "25h 1m")   // no day rollover
    }

    @Test func subMinuteFlightShowsSecondsNotZeroHours() {
        #expect(LogbookViewModel.formatDurationHM(48) == "48s")      // the 48 s flight from the review
        #expect(LogbookViewModel.formatDurationHM(59.9) == "59s")    // truncates, never rounds up to a minute
        #expect(LogbookViewModel.formatDurationHM(60) == "0h 1m")
        #expect(LogbookViewModel.formatDurationHM(-5) == "0s")
    }
}
