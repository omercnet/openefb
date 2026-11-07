//
//  TelemetryTests.swift
//  efb-212Tests
//
//  MetricKit diagnostic JSON to TelemetryDeck signal parameters, and the recording duration bucket.
//  Samples follow the `MXDiagnostic.jsonRepresentation()` shape (diagnosticMetaData + callStackTree,
//  each frame's caller nested as its first subframe).
//

import Testing
import Foundation
@testable import efb_212

@Suite("Telemetry Tests")
struct TelemetryTests {

    /// A crashed thread ten frames deep (frame0 innermost) plus an unattributed thread.
    static func crashJSON() throws -> Data {
        var frame: [String: Any]?
        for index in (0..<10).reversed() {
            var current: [String: Any] = [
                "binaryUUID": "CDB53DDB-2337-4933-B62F-4356E6174AF0",
                "binaryName": "bin\(index)",
                "offsetIntoBinaryTextSegment": 100 + index,
                "address": 74565 + index,
                "sampleCount": 1,
            ]
            if let frame { current["subFrames"] = [frame] }
            frame = current
        }
        let meta: [String: Any] = [
            "appBuildVersion": "42",
            "appVersion": "1.0",
            "exceptionType": 1,
            "exceptionCode": 0,
            "signal": 11,
            "osVersion": "iPhone OS 26.0 (23A341)",
            "terminationReason": "Namespace SIGNAL, Code 0xb " + String(repeating: "x", count: 300),
            "virtualMemoryRegionInfo": "0 is not in any region.",
        ]
        let other: [String: Any] = ["binaryName": "other", "offsetIntoBinaryTextSegment": 1]
        let stacks: [[String: Any]] = [
            ["threadAttributed": false, "callStackRootFrames": [other]],
            ["threadAttributed": true, "callStackRootFrames": [try #require(frame)]],
        ]
        let tree: [String: Any] = ["callStackPerThread": true, "callStacks": stacks]
        let root: [String: Any] = ["version": "1.0.0", "diagnosticMetaData": meta, "callStackTree": tree]
        return try JSONSerialization.data(withJSONObject: root)
    }

    static let hangJSON = Data("""
    {
      "version": "1.0.0",
      "diagnosticMetaData": {
        "appBuildVersion": "42",
        "appVersion": "1.0",
        "hangDuration": "20 secs.",
        "osVersion": "iPhone OS 26.0 (23A341)"
      },
      "callStackTree": {
        "callStackPerThread": true,
        "callStacks": [
          {
            "threadAttributed": true,
            "callStackRootFrames": [
              {
                "binaryName": "libsystem_kernel.dylib",
                "offsetIntoBinaryTextSegment": 2048,
                "sampleCount": 20,
                "subFrames": [
                  { "binaryName": "efb-212", "offsetIntoBinaryTextSegment": 4096, "sampleCount": 20 }
                ]
              }
            ]
          }
        ]
      }
    }
    """.utf8)

    @Test("Crash: metadata, no free-text termination reason, top 8 frames of the crashed thread in order")
    func crashParameters() throws {
        let parameters = try #require(Telemetry.crashParameters(try Self.crashJSON()))
        #expect(parameters["exceptionType"] == "1")
        #expect(parameters["exceptionCode"] == "0")
        #expect(parameters["signal"] == "11")
        #expect(parameters["appBuildVersion"] == "42")
        #expect(parameters["osVersion"] == "iPhone OS 26.0 (23A341)")
        #expect(parameters["terminationReason"] == nil)
        #expect(parameters["topFrames"] == (0..<8).map { "bin\($0)+\(100 + $0)" }.joined(separator: " | "))
        #expect(parameters["virtualMemoryRegionInfo"] == nil)
    }

    @Test("Hang: duration, build and frames")
    func hangParameters() throws {
        let parameters = try #require(Telemetry.hangParameters(Self.hangJSON))
        #expect(parameters == [
            "hangDuration": "20 secs.",
            "appBuildVersion": "42",
            "topFrames": "libsystem_kernel.dylib+2048 | efb-212+4096",
        ])
    }

    @Test("Malformed JSON yields no parameters")
    func malformed() {
        #expect(Telemetry.crashParameters(Data("not json".utf8)) == nil)
        #expect(Telemetry.hangParameters(Data("{\"callStackTree\":{}}".utf8)) == nil)
        #expect(Telemetry.crashParameters(Data()) == nil)
    }

    @Test("Recording duration buckets")
    func durationBucket() {
        #expect(Telemetry.durationBucket(0) == "0-15")
        #expect(Telemetry.durationBucket(14 * 60) == "0-15")
        #expect(Telemetry.durationBucket(15 * 60) == "15-60")
        #expect(Telemetry.durationBucket(60 * 60) == "60+")
    }
}
