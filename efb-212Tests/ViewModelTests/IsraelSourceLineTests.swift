//
//  IsraelSourceLineTests.swift
//  efb-212Tests
//
//  The Israel source badge: amber only for a caution (chart missing or outdated), never for plain
//  information, and no diagram line unless a diagram is actually on screen from an installed pack.
//

import Testing
@testable import efb_212

@MainActor
@Suite("Israel Source Line Tests")
struct IsraelSourceLineTests {

    @Test func missingChartIsACaution() {
        let line = IsraelSourceLine.chart(.notDownloaded)
        #expect(line.isCaution)
        #expect(line.detail.contains("Official chart not downloaded"))
    }

    @Test func installedChartIsNotACautionAndShowsItsEdition() {
        let line = IsraelSourceLine.chart(.installed(edition: "2026-08", label: "AMDT 001/2026"))
        #expect(!line.isCaution)
        #expect(line.summary == "AMDT 001/2026")
    }

    @Test func newerEditionIsACautionAndSaysSo() {
        let line = IsraelSourceLine.chart(.updateAvailable(installedEdition: "2026-01", installedLabel: "AMDT 1", latestEdition: "2026-08", latestLabel: "AMDT 2"))
        #expect(line.isCaution)
        #expect(line.summary.contains("update"))
    }

    @Test func noDiagramLineWithoutAPackOrWithNothingDrawn() {
        #expect(IsraelSourceLine.diagrams(pack: nil, shown: ["LLBG"]) == nil)
    }
}
