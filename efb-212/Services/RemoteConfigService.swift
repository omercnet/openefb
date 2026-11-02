//
//  RemoteConfigService.swift
//  efb-212
//
//  Downloads the remote config file from the relay (web/notam-relay, GET /config.json). Transport only:
//  `RemoteConfigStore` parses, validates, caches and applies it. HTTPS from the relay is the only trust
//  there is (no signature), so the limits in `RemoteConfig` are what bound a file.
//

import Foundation
import os

nonisolated protocol RemoteConfigServiceProtocol: Sendable {
    /// The raw body of the config file. Throws on transport errors, non-200 answers and oversized bodies.
    func fetchConfigData() async throws -> Data
}

actor RemoteConfigService: RemoteConfigServiceProtocol {

    nonisolated static let urlDefaultsKey = "remoteConfigURL"
    /// The deployed relay (web/notam-relay, Cloudflare Worker). The `urlDefaultsKey` setting overrides it,
    /// e.g. launch argument `-remoteConfigURL http://127.0.0.1:8787/config.json` against `wrangler dev`.
    nonisolated static let defaultURL = URL(string: "https://openefb-notam-relay.omerc.workers.dev/config.json")

    private let session: URLSession
    private let urlProvider: @Sendable () -> URL?
    private let logger = Logger(subsystem: "quartermint.efb-212", category: "RemoteConfigService")

    /// - Parameters:
    ///   - session: Override for tests; defaults to a session with short timeouts and no HTTP cache
    ///     (the relay already sets a 5 minute edge cache, and a second cache on the device would hide a fix).
    ///   - url: Override for tests; defaults to the URL stored under `urlDefaultsKey`, else `defaultURL`.
    init(session: URLSession? = nil, url: (@Sendable () -> URL?)? = nil) {
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 10
            config.timeoutIntervalForResource = 20
            config.waitsForConnectivity = false
            config.requestCachePolicy = .reloadIgnoringLocalCacheData
            self.session = URLSession(configuration: config)
        }
        self.urlProvider = url ?? {
            UserDefaults.standard.string(forKey: RemoteConfigService.urlDefaultsKey).flatMap(URL.init(string:))
                ?? RemoteConfigService.defaultURL
        }
    }

    func fetchConfigData() async throws -> Data {
        guard let url = urlProvider() else { throw EFBError.remoteConfigRejected("no config address") }
        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            logger.error("Remote config answered HTTP \(status)")
            throw EFBError.remoteConfigRejected("the server answered \(status)")
        }
        guard data.count <= RemoteConfig.maximumBytes else {
            throw EFBError.remoteConfigRejected("the file is too large")
        }
        return data
    }
}
