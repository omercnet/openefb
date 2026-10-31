//
//  MockTerminalProcedureService.swift
//  efb-212Tests
//
//  Mock d-TPP service for components that depend on TerminalProcedureServiceProtocol.
//

import Foundation
@testable import efb_212

final class MockTerminalProcedureService: TerminalProcedureServiceProtocol, @unchecked Sendable {
    var mockCharts: [TerminalChart] = []
    var mockCycle = TerminalProcedureService.cycle(containing: Date())
    var mockPDFURL = URL(fileURLWithPath: "/dev/null")
    var shouldFail = false

    func charts(for airport: Airport) async throws -> [TerminalChart] {
        if shouldFail { throw EFBError.chartDownloadFailed("FAA terminal procedures") }
        return mockCharts
    }

    func pdfURL(for chart: TerminalChart) async throws -> URL {
        if shouldFail { throw EFBError.chartDownloadFailed(chart.name) }
        return mockPDFURL
    }

    func currentCycle() async throws -> DTPPCycle {
        if shouldFail { throw EFBError.chartDownloadFailed("FAA terminal procedures") }
        return mockCycle
    }
}
