//
//  RegionStore.swift
//  efb-212
//
//  Reads and writes the operating region in the single UserSettings record.
//

import Foundation
import SwiftData

enum RegionStore {

    /// The saved region; `Region.defaultRegion` when no settings record exists yet.
    @MainActor
    static func load(from context: ModelContext) -> Region {
        settings(in: context)?.region ?? Region.defaultRegion
    }

    /// Save the region, creating the settings record on first use.
    @MainActor
    static func save(_ region: Region, to context: ModelContext) throws {
        if let existing = settings(in: context) {
            existing.region = region
        } else {
            let created = SchemaV1.UserSettings()
            created.region = region
            context.insert(created)
        }
        try context.save()
    }

    /// The oldest settings record (there is only ever one; the oldest wins if a duplicate appears).
    @MainActor
    private static func settings(in context: ModelContext) -> SchemaV1.UserSettings? {
        var descriptor = FetchDescriptor<SchemaV1.UserSettings>(sortBy: [SortDescriptor(\.createdAt)])
        descriptor.fetchLimit = 1
        return (try? context.fetch(descriptor))?.first
    }
}

extension Region {
    /// Why the region's bundled aviation data can't be opened, or nil when it opens (or the region
    /// needs no bundled file: the US is served by `aviation.sqlite` through `DatabaseManager`).
    /// Israel opens `israel-aviation.sqlite` (tools/caai-importer) and reports what went wrong.
    nonisolated var dataUnavailableError: EFBError? {
        switch self {
        case .us:
            return nil
        case .israel:
            do {
                _ = try IsraelAviationDatabase.bundled()
                return nil
            } catch let error as EFBError {
                return error
            } catch {
                return .databaseCorrupted
            }
        }
    }

    /// Attribution for Settings > About. Israel shows the line stored in the bundled database's
    /// `metadata` (CAAI, with the source data date); the fallback applies when it can't be read.
    nonisolated var dataAttribution: String {
        switch self {
        case .us:
            return fallbackDataAttribution
        case .israel:
            return (try? IsraelAviationDatabase.bundled().metadata().attribution) ?? fallbackDataAttribution
        }
    }
}
