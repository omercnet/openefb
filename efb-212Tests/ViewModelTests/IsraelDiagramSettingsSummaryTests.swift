//
//  IsraelDiagramSettingsSummaryTests.swift
//  efb-212Tests
//
//  Settings > Region wording for the aerodrome diagram pack (IL-DEFAULT).
//

import Testing
@testable import efb_212

@Suite("Israel Diagram Settings Summary Tests")
@MainActor
struct IsraelDiagramSettingsSummaryTests {

    @Test func notDownloadedWithoutAServerAnswerNeverImpliesAnEdition() {
        let offline = IsraelDiagramSettingsSummary(pack: nil, latest: nil, isChecking: false, checkFailed: true)
        #expect(offline.detail.contains("Not downloaded"))
        #expect(offline.detail.contains("Can't reach"))
        #expect(offline.placed == nil)

        let checking = IsraelDiagramSettingsSummary(pack: nil, latest: nil, isChecking: true, checkFailed: false)
        #expect(checking.detail.contains("Checking"))
    }
}
