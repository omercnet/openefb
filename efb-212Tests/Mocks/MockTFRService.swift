//
//  MockTFRService.swift
//  efb-212Tests
//
//  Mock TFR service for testing components that depend on TFRServiceProtocol.
//

import Foundation
@testable import efb_212

final class MockTFRService: TFRServiceProtocol, @unchecked Sendable {
    var mockTFRs: [TFR] = []
    var fetchedAt: Date = Date()
    var shouldFail: Bool = false
    var fetchCallCount: Int = 0

    func currentTFRs() async throws -> TFRSnapshot {
        fetchCallCount += 1
        if shouldFail {
            throw EFBError.tfrFetchFailed(underlying: NSError(domain: "test", code: -1))
        }
        return TFRSnapshot(tfrs: mockTFRs, fetchedAt: fetchedAt)
    }
}
