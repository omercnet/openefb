//
//  MockWindsAloftService.swift
//  efb-212Tests
//
//  Mock winds aloft service for testing components that depend on WindsAloftServiceProtocol.
//

import Foundation
import CoreLocation
@testable import efb_212

final class MockWindsAloftService: WindsAloftServiceProtocol, @unchecked Sendable {
    var mockReport: WindsAloftReport?
    var fetchCallCount: Int = 0
    var lastForecast: WindsAloftForecast?

    func fetchWindsAloft(
        near coordinate: CLLocationCoordinate2D,
        forecast: WindsAloftForecast
    ) async throws -> WindsAloftReport {
        fetchCallCount += 1
        lastForecast = forecast
        guard let mockReport else {
            throw EFBError.weatherFetchFailed(underlying: NSError(domain: "test", code: -1))
        }
        return mockReport
    }
}
