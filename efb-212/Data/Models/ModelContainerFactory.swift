//
//  ModelContainerFactory.swift
//  efb-212
//
//  The one place the app's SwiftData ModelContainer is built. It always goes through the
//  versioned schema and `EFBSchemaMigrationPlan`, so a future SchemaV2 migrates the user's
//  existing store instead of being ignored. The model list lives only in `SchemaV1.models`.
//

import Foundation
import SwiftData
import OSLog

enum EFBModelContainer {

    private static let log = Logger(subsystem: "io.omer.efb", category: "SwiftData")

    /// Container for the current schema, opened through the migration plan.
    /// - Parameters:
    ///   - url: On-disk store location; nil uses SwiftData's default store (what the app has always used).
    ///   - inMemory: Keep the store in memory only (tests, fallback). Ignores `url`.
    static func make(url: URL? = nil, inMemory: Bool = false) throws -> ModelContainer {
        let schema = Schema(versionedSchema: SchemaV1.self)
        let configuration: ModelConfiguration
        if inMemory {
            configuration = ModelConfiguration(isStoredInMemoryOnly: true)
        } else if let url {
            configuration = ModelConfiguration(url: url)
        } else {
            configuration = ModelConfiguration()
        }
        return try ModelContainer(
            for: schema,
            migrationPlan: EFBSchemaMigrationPlan.self,
            configurations: configuration
        )
    }

    /// Container for the running app. If the on-disk store cannot be opened, the store is left
    /// untouched (never deleted or recreated) and the app runs on an in-memory container so it
    /// still launches; the failure is logged.
    static func makeForApp() -> ModelContainer {
        do {
            return try make()
        } catch {
            log.error("Could not open the SwiftData store: \(String(describing: error), privacy: .public)")
            do {
                return try make(inMemory: true)
            } catch {
                // An in-memory store over a fixed schema failing is a programmer error.
                fatalError("SwiftData in-memory container failed: \(error)")
            }
        }
    }
}
