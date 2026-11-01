//
//  MockIsraelNotamService.swift
//  efb-212Tests
//
//  Canned Israel NOTAM feed for view-model and alert tests.
//

import Foundation
@testable import efb_212

nonisolated final class MockIsraelNotamService: IsraelNotamServiceProtocol, @unchecked Sendable {
    private let lock = NSLock()
    private var _result: Result<IsraelNotamReport, Error>
    private var _forceRefreshFlags: [Bool] = []

    init(result: Result<IsraelNotamReport, Error>) {
        _result = result
    }

    /// `forceRefresh` argument of every call, in order.
    var forceRefreshFlags: [Bool] { lock.withLock { _forceRefreshFlags } }

    func fetchFeed(forceRefresh: Bool) async throws -> IsraelNotamReport {
        try lock.withLock {
            _forceRefreshFlags.append(forceRefresh)
            return try _result.get()
        }
    }
}
