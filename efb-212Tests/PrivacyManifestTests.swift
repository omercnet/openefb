//
//  PrivacyManifestTests.swift
//  efb-212Tests
//
//  Validates that PrivacyInfo.xcprivacy contains all required Apple privacy
//  declarations for App Store Connect / TestFlight submission.
//  Reads the manifest from the project source directory via #filePath.
//

import Testing
import Foundation

@Suite("Privacy Manifest Validation")
struct PrivacyManifestTests {

    // MARK: - Test Helpers

    /// Load and parse PrivacyInfo.xcprivacy from the project source directory.
    /// Uses #filePath to derive the project root, then reads efb-212/PrivacyInfo.xcprivacy.
    private func loadPrivacyManifest() throws -> [String: Any] {
        // #filePath gives: .../efb-212Tests/PrivacyManifestTests.swift
        // Navigate up to project root: efb-212Tests/ -> project root
        let testFilePath = URL(fileURLWithPath: #filePath)
        let projectRoot = testFilePath
            .deletingLastPathComponent()  // Remove PrivacyManifestTests.swift
            .deletingLastPathComponent()  // Remove efb-212Tests/
        let manifestPath = projectRoot
            .appendingPathComponent("efb-212")
            .appendingPathComponent("PrivacyInfo.xcprivacy")

        let data = try Data(contentsOf: manifestPath)
        let plist = try PropertyListSerialization.propertyList(
            from: data,
            options: [],
            format: nil
        )
        guard let dict = plist as? [String: Any] else {
            throw ManifestError.invalidFormat
        }
        return dict
    }

    private enum ManifestError: Error {
        case invalidFormat
    }

    // MARK: - Tests

    @Test("PrivacyInfo.xcprivacy file exists in project directory")
    func privacyManifestFileExists() throws {
        let testFilePath = URL(fileURLWithPath: #filePath)
        let projectRoot = testFilePath
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let manifestPath = projectRoot
            .appendingPathComponent("efb-212")
            .appendingPathComponent("PrivacyInfo.xcprivacy")

        #expect(FileManager.default.fileExists(atPath: manifestPath.path))
    }

    @Test("NSPrivacyTracking is set to false")
    func noTracking() throws {
        let manifest = try loadPrivacyManifest()

        guard let tracking = manifest["NSPrivacyTracking"] as? Bool else {
            Issue.record("NSPrivacyTracking key missing or not a boolean")
            return
        }
        #expect(tracking == false)
    }

    @Test("NSPrivacyTrackingDomains is present and empty")
    func emptyTrackingDomains() throws {
        let manifest = try loadPrivacyManifest()

        guard let domains = manifest["NSPrivacyTrackingDomains"] as? [Any] else {
            Issue.record("NSPrivacyTrackingDomains key missing or not an array")
            return
        }
        #expect(domains.isEmpty, "Tracking domains should be empty (no tracking)")
    }

    @Test("Collected data types declare Coarse Location, Crash Data and Performance Data")
    func collectedDataTypes() throws {
        let manifest = try loadPrivacyManifest()

        guard let collectedTypes = manifest["NSPrivacyCollectedDataTypes"] as? [[String: Any]] else {
            Issue.record("NSPrivacyCollectedDataTypes missing or not an array of dicts")
            return
        }

        // Matches the App Store privacy label (Q13): map area and airport requests reach third-party hosts.
        // Location and audio are otherwise processed on the device only. Crash and hang summaries (MetricKit)
        // go to TelemetryDeck; its SDK declares its own Product Interaction and Device ID entries.
        let dataTypeNames = collectedTypes.compactMap {
            $0["NSPrivacyCollectedDataType"] as? String
        }
        #expect(dataTypeNames == [
            "NSPrivacyCollectedDataTypeCoarseLocation",
            "NSPrivacyCollectedDataTypeCrashData",
            "NSPrivacyCollectedDataTypePerformanceData",
        ], "Must declare Coarse Location, Crash Data and Performance Data and nothing else")

        // Verify neither is used for tracking
        for entry in collectedTypes {
            let isTracking = entry["NSPrivacyCollectedDataTypeTracking"] as? Bool
            #expect(isTracking == false,
                    "Collected data type should not be used for tracking")

            let isLinked = entry["NSPrivacyCollectedDataTypeLinked"] as? Bool
            #expect(isLinked == false,
                    "Collected data type should not be linked to identity")

            guard let purposes = entry["NSPrivacyCollectedDataTypePurposes"] as? [String] else {
                Issue.record("Missing purposes array for collected data type")
                continue
            }
            #expect(purposes.contains("NSPrivacyCollectedDataTypePurposeAppFunctionality"),
                    "Purpose should be app functionality")
        }
    }

    @Test("Accessed API types declare UserDefaults (CA92.1) and FileTimestamp (C617.1)")
    func accessedAPITypes() throws {
        let manifest = try loadPrivacyManifest()

        guard let apiTypes = manifest["NSPrivacyAccessedAPITypes"] as? [[String: Any]] else {
            Issue.record("NSPrivacyAccessedAPITypes missing or not an array of dicts")
            return
        }

        var reasonsByCategory: [String: [String]] = [:]
        for entry in apiTypes {
            guard let category = entry["NSPrivacyAccessedAPIType"] as? String,
                  let reasons = entry["NSPrivacyAccessedAPITypeReasons"] as? [String] else {
                Issue.record("API entry missing category or reasons: \(entry)")
                continue
            }
            reasonsByCategory[category] = reasons
        }

        #expect(reasonsByCategory["NSPrivacyAccessedAPICategoryUserDefaults"]?.contains("CA92.1") == true,
                "UserDefaults reason must include CA92.1 (app's own defaults)")
        // FlightRecoveryService reads the creation date of the app's own audio files.
        #expect(reasonsByCategory["NSPrivacyAccessedAPICategoryFileTimestamp"]?.contains("C617.1") == true,
                "FileTimestamp reason must include C617.1 (files inside the app container)")
    }
}
