//
//  MockNotamService.swift
//  efb-212Tests
//
//  Mock NOTAM service for testing components that depend on NotamServiceProtocol.
//

import Foundation
@testable import efb_212

final class MockNotamService: NotamServiceProtocol, @unchecked Sendable {
    var mockNotams: [Notam] = []
    var errorToThrow: Error?
    var fetchedAt: Date = Date()
    var fetchCallCount: Int = 0

    func fetchNotams(for airport: Airport) async throws -> NotamReport {
        fetchCallCount += 1
        if let errorToThrow {
            throw errorToThrow
        }
        return NotamReport(location: airport.icao, notams: mockNotams, fetchedAt: fetchedAt)
    }
}
