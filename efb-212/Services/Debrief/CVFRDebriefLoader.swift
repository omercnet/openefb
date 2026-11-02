//
//  CVFRDebriefLoader.swift
//  efb-212
//
//  Loads a flight's track, transcript and stored plan legs from the RecordingDatabase, the route network
//  from the Israel aviation database, and builds the CVFR debrief. Nil for flights outside Israel (US
//  flights are unchanged).
//

import Foundation
import CoreLocation

nonisolated enum CVFRDebriefLoader {

    /// The CVFR debrief with the bundled Israel database; nil when it is unavailable or the flight is not an Israel flight.
    static func loadBundled(flightID: UUID, recordingDB: RecordingDatabase) -> CVFRDebrief? {
        guard let israelDB = try? IsraelAviationDatabase.bundled() else { return nil }
        return try? load(flightID: flightID, recordingDB: recordingDB, israelDB: israelDB)
    }

    /// The CVFR debrief for `flightID`, or nil when the flight was not flown on the Israel network.
    static func load(
        flightID: UUID,
        recordingDB: RecordingDatabase,
        israelDB: any IsraelAviationDatabaseProtocol
    ) throws -> CVFRDebrief? {
        let track = try recordingDB.trackPoints(forFlight: flightID)
        guard let first = track.first,
              Region.israel.contains(CLLocationCoordinate2D(latitude: first.latitude, longitude: first.longitude))
        else { return nil }

        let transcript = try recordingDB.transcriptSegments(forFlight: flightID)
        let storedLegs = try recordingDB.routeLegs(forFlight: flightID)
        let segments = try israelDB.routeSegments(in: .wholeCountry)
        let points = try israelDB.reportingPoints(in: .wholeCountry)

        var pointsByCode: [String: IsraelReportingPoint] = [:]
        for point in points where pointsByCode[point.code] == nil { pointsByCode[point.code] = point }

        let planned = resolve(legs: storedLegs, segments: segments)
        let debrief = CVFRDebriefBuilder.build(
            trackPoints: track,
            transcript: transcript,
            plannedLegs: planned,
            segments: segments,
            points: pointsByCode
        )
        return debrief.isEmpty ? nil : debrief
    }

    /// Resolve stored code pairs to segments: the published direction first, else the reverse.
    /// nil when there are no stored legs; a code pair with no segment is skipped.
    static func resolve(legs: [(from: String, to: String)], segments: [IsraelRouteSegment]) -> [CVFRRouteLeg]? {
        guard !legs.isEmpty else { return nil }
        let resolved = legs.compactMap { pair -> CVFRRouteLeg? in
            if let forward = segments.first(where: { $0.fromCode == pair.from && $0.toCode == pair.to }) {
                return CVFRRouteLeg(segment: forward, forward: true)
            }
            if let reverse = segments.first(where: { $0.fromCode == pair.to && $0.toCode == pair.from }) {
                return CVFRRouteLeg(segment: reverse, forward: false)
            }
            return nil
        }
        return resolved.isEmpty ? nil : resolved
    }
}
