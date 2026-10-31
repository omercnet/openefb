//
//  MockAirSigmetService.swift
//  efb-212Tests
//
//  Mock AIRMET/SIGMET service for testing components that depend on AirSigmetServiceProtocol.
//

import Foundation
@testable import efb_212

final class MockAirSigmetService: AirSigmetServiceProtocol, @unchecked Sendable {
    var mockAdvisories: [AviationAdvisory] = []
    var fetchedAt: Date = Date()
    var shouldFail: Bool = false
    var fetchCallCount: Int = 0

    func currentAdvisories() async throws -> AdvisorySnapshot {
        fetchCallCount += 1
        if shouldFail {
            throw EFBError.weatherFetchFailed(underlying: NSError(domain: "test", code: -1))
        }
        return AdvisorySnapshot(advisories: mockAdvisories, fetchedAt: fetchedAt)
    }
}
