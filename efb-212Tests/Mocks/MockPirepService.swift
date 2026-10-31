//
//  MockPirepService.swift
//  efb-212Tests
//
//  Mock PIREP service for testing components that depend on PirepServiceProtocol.
//

import Foundation
import CoreLocation
@testable import efb_212

final class MockPirepService: PirepServiceProtocol, @unchecked Sendable {
    var mockPireps: [Pirep] = []
    var shouldFail: Bool = false
    var fetchCallCount: Int = 0
    var lastRadiusNM: Double?
    var lastMaxAge: TimeInterval?

    func fetchPireps(
        near coordinate: CLLocationCoordinate2D,
        radiusNM: Double,
        maxAge: TimeInterval
    ) async throws -> [Pirep] {
        fetchCallCount += 1
        lastRadiusNM = radiusNM
        lastMaxAge = maxAge
        if shouldFail {
            throw EFBError.weatherFetchFailed(underlying: NSError(domain: "test", code: -1))
        }
        return mockPireps
    }
}
