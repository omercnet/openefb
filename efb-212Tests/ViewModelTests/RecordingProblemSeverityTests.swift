//
//  RecordingProblemSeverityTests.swift
//  efb-212Tests
//
//  The recording HUD shows RecordingViewModel.lastError amber while the recording keeps
//  running (audio stopped, GPS track continues) and red once it has stopped (efb-k1p).
//

import Testing
@testable import efb_212

@Suite("Recording problem severity")
struct RecordingProblemSeverityTests {

    @Test func runningRecordingIsCaution() {
        #expect(RecordingViewModel.problemSeverity(for: .recording) == .caution)
        #expect(RecordingViewModel.problemSeverity(for: .paused) == .caution)
    }

    @Test func stoppedOrNeverStartedRecordingIsWarning() {
        #expect(RecordingViewModel.problemSeverity(for: .idle) == .warning)
        #expect(RecordingViewModel.problemSeverity(for: .stopping) == .warning)
        #expect(RecordingViewModel.problemSeverity(for: .countdown(remaining: 2)) == .warning)
    }
}
