//
//  MockRemoteConfigService.swift
//  efb-212Tests
//
//  Canned remote config answers, one per call (the last one repeats), and a call counter.
//

import Foundation
@testable import efb_212

nonisolated final class MockRemoteConfigService: RemoteConfigServiceProtocol, @unchecked Sendable {
    private let lock = NSLock()
    private var results: [Result<Data, Error>]
    private var _callCount = 0

    init(_ results: [Result<Data, Error>]) {
        precondition(!results.isEmpty)
        self.results = results
    }

    convenience init(data: Data) { self.init([.success(data)]) }

    /// Fails like a device with no network.
    static func offline() -> MockRemoteConfigService {
        MockRemoteConfigService([.failure(URLError(.notConnectedToInternet))])
    }

    var callCount: Int { lock.withLock { _callCount } }

    /// Replaces what the next calls return.
    func setResults(_ newResults: [Result<Data, Error>]) {
        lock.withLock { results = newResults }
    }

    func fetchConfigData() async throws -> Data {
        try lock.withLock {
            let index = min(_callCount, results.count - 1)
            _callCount += 1
            return try results[index].get()
        }
    }
}
