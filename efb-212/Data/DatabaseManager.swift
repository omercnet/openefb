//
//  DatabaseManager.swift
//  efb-212
//
//  DatabaseServiceProtocol implementation that coordinates the GRDB aviation database.
//  Delegates all queries to AviationDatabase, propagating EFBError on failure.
//
//  Marked @unchecked Sendable because AviationDatabase (wrapping GRDB DatabasePool)
//  is inherently thread-safe.
//

import Foundation
import CoreLocation

final class DatabaseManager: DatabaseServiceProtocol, @unchecked Sendable {

    let aviationDB: AviationDatabase

    /// Initialize by creating an AviationDatabase instance.
    /// Throws EFBError.databaseCorrupted if the bundled database is missing.
    nonisolated init() throws {
        self.aviationDB = try AviationDatabase()
    }

    /// Initialize from an explicit bundled file and install directory (tests).
    /// Throws EFBError.databaseCorrupted if `bundledURL` does not exist.
    nonisolated init(bundledURL: URL, installDirectory: URL, dataVersion: String = AviationDatabase.bundledDataVersion) throws {
        self.aviationDB = try AviationDatabase(
            bundledURL: bundledURL,
            installDirectory: installDirectory,
            dataVersion: dataVersion
        )
    }

    /// Internal init for testing with a pre-configured AviationDatabase.
    nonisolated init(aviationDB: AviationDatabase) {
        self.aviationDB = aviationDB
    }

    // MARK: - DatabaseServiceProtocol

    nonisolated func airport(byICAO icao: String) throws -> Airport? {
        try aviationDB.airport(byICAO: icao)
    }

    nonisolated func airports(near coordinate: CLLocationCoordinate2D, radiusNM: Double) throws -> [Airport] {
        try aviationDB.airports(near: coordinate, radiusNM: radiusNM)
    }

    nonisolated func toweredAirports(near coordinate: CLLocationCoordinate2D, radiusNM: Double) throws -> [Airport] {
        try aviationDB.toweredAirports(near: coordinate, radiusNM: radiusNM)
    }

    nonisolated func nearestAirports(to coordinate: CLLocationCoordinate2D, count: Int) throws -> [Airport] {
        try aviationDB.nearestAirports(to: coordinate, count: count)
    }

    nonisolated func searchAirports(query: String, limit: Int) throws -> [Airport] {
        try aviationDB.searchAirports(query: query, limit: limit)
    }

    nonisolated func airspaces(near coordinate: CLLocationCoordinate2D, radiusNM: Double) throws -> [Airspace] {
        try aviationDB.airspaces(near: coordinate, radiusNM: radiusNM)
    }

    nonisolated func navaids(near coordinate: CLLocationCoordinate2D, radiusNM: Double) throws -> [Navaid] {
        try aviationDB.navaids(near: coordinate, radiusNM: radiusNM)
    }

    nonisolated func dataCycle() throws -> AviationDataCycle? {
        try aviationDB.dataCycle()
    }
}

// MARK: - Unavailable Database

/// Database service used when the aviation database failed to open.
/// Every query throws EFBError.databaseCorrupted so callers surface the failure
/// instead of showing an empty sky. AppState.databaseError carries the original error.
final class UnavailableDatabaseService: DatabaseServiceProtocol, @unchecked Sendable {

    nonisolated init() {}

    nonisolated func airport(byICAO icao: String) throws -> Airport? {
        throw EFBError.databaseCorrupted
    }

    nonisolated func airports(near coordinate: CLLocationCoordinate2D, radiusNM: Double) throws -> [Airport] {
        throw EFBError.databaseCorrupted
    }

    nonisolated func toweredAirports(near coordinate: CLLocationCoordinate2D, radiusNM: Double) throws -> [Airport] {
        throw EFBError.databaseCorrupted
    }

    nonisolated func nearestAirports(to coordinate: CLLocationCoordinate2D, count: Int) throws -> [Airport] {
        throw EFBError.databaseCorrupted
    }

    nonisolated func searchAirports(query: String, limit: Int) throws -> [Airport] {
        throw EFBError.databaseCorrupted
    }

    nonisolated func airspaces(near coordinate: CLLocationCoordinate2D, radiusNM: Double) throws -> [Airspace] {
        throw EFBError.databaseCorrupted
    }

    nonisolated func navaids(near coordinate: CLLocationCoordinate2D, radiusNM: Double) throws -> [Navaid] {
        throw EFBError.databaseCorrupted
    }

    nonisolated func dataCycle() throws -> AviationDataCycle? {
        throw EFBError.databaseCorrupted
    }
}
