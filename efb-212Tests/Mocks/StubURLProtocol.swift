//
//  StubURLProtocol.swift
//  efb-212Tests
//
//  Serves canned HTTP responses to a URLSession without the network.
//  Handlers are scoped per session (via a request header), so suites running in
//  parallel never see each other's responses.
//

import Foundation

nonisolated final class StubURLProtocol: URLProtocol, @unchecked Sendable {

    /// Returns (HTTP status, body) for a request, or throws to simulate a transport error.
    typealias Handler = @Sendable (URLRequest) throws -> (Int, Data)

    private static let headerName = "X-Stub-Session"
    private static let lock = NSLock()
    nonisolated(unsafe) private static var handlers: [String: Handler] = [:]

    /// A URLSession whose requests are all answered by `handler`.
    static func session(handler: @escaping Handler) -> URLSession {
        let id = UUID().uuidString
        lock.withLock { handlers[id] = handler }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        config.httpAdditionalHeaders = [headerName: id]
        return URLSession(configuration: config)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let id = request.value(forHTTPHeaderField: Self.headerName) ?? ""
        let handler = Self.lock.withLock { Self.handlers[id] }
        do {
            guard let handler, let url = request.url else { throw URLError(.notConnectedToInternet) }
            let (status, data) = try handler(request)
            guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil) else {
                throw URLError(.badServerResponse)
            }
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
