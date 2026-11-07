//
//  FlightLogNextTests.swift
//  efb-212Tests
//
//  The NEXT data line under the next waypoint: a stale fix never shows or announces the last
//  distance, bearing and ETA as current; missing values dash.
//

import Testing
import Foundation
@testable import efb_212

@Suite("Flight log NEXT data line")
struct FlightLogNextTests {

    private let utc = TimeZone(identifier: "UTC")!
    /// 2026-01-01 15:41:00 UTC.
    private let eta = Date(timeIntervalSince1970: 1_767_282_060)

    @Test func freshFixShowsFormattedValues() {
        let text = FlightLogStrip.nextDataText(distanceNM: 18.4, bearingTrue: 41, eta: eta, timeZone: utc, stale: false)
        #expect(text == "18.4 NM \u{00B7} 041\u{00B0} \u{00B7} ETA 15:41")
        let spoken = FlightLogStrip.nextDataSpoken(distanceNM: 18.4, bearingTrue: 41, eta: eta, timeZone: utc, stale: false)
        #expect(spoken == "18.4 NM \u{00B7} 041\u{00B0} \u{00B7} ETA 15:41")
    }

    @Test func staleFixDashesEverything() {
        let text = FlightLogStrip.nextDataText(distanceNM: 18.4, bearingTrue: 41, eta: eta, timeZone: utc, stale: true)
        #expect(text == "--- NM \u{00B7} ---\u{00B0} \u{00B7} ETA ---")
        #expect(!text.contains("18.4") && !text.contains("041") && !text.contains("15:41"))
    }

    @Test func staleFixAnnouncesNoNumbersAndSaysStale() {
        let spoken = FlightLogStrip.nextDataSpoken(distanceNM: 18.4, bearingTrue: 41, eta: eta, timeZone: utc, stale: true)
        #expect(spoken.hasSuffix(", stale"))
        #expect(!spoken.contains("18.4") && !spoken.contains("041") && !spoken.contains("15:41"))
    }

    @Test func missingValuesDash() {
        let text = FlightLogStrip.nextDataText(distanceNM: nil, bearingTrue: nil, eta: nil, stale: false)
        #expect(text == "--- NM \u{00B7} ---\u{00B0} \u{00B7} ETA ---")
        #expect(FlightLogStrip.nextDataSpoken(distanceNM: nil, bearingTrue: nil, eta: nil, stale: false).isEmpty)
    }

    @Test func partialValuesDashOnlyTheMissingOnes() {
        let text = FlightLogStrip.nextDataText(distanceNM: 3.2, bearingTrue: nil, eta: nil, stale: false)
        #expect(text == "3.2 NM \u{00B7} ---\u{00B0} \u{00B7} ETA ---")
        #expect(FlightLogStrip.nextDataSpoken(distanceNM: 3.2, bearingTrue: nil, eta: nil, stale: false) == "3.2 NM")
    }
}
