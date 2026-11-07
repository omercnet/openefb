//
//  CVFRDebrief.swift
//  efb-212
//
//  Debrief of a recorded flight against the Israel CVFR route network (IL-DEBRIEF):
//  - match the GPS track to route legs (the activated plan's legs, or the nearest segments);
//  - per leg, time-weighted altitude adherence against the published altitude for the direction flown;
//  - per reporting point on the route, the closest approach and whether a position report was heard;
//  - the flown altitude on one distance axis along the matched legs (the unrolled debrief) and its verdict.
//
//  Pure and nonisolated: every number here comes from code, never from the language model.
//  Units: feet MSL, nautical miles, degrees true, seconds.
//

import Foundation
import CoreLocation

// MARK: - Result types

/// One route leg the flight was matched to, with its altitude adherence.
nonisolated struct CVFRLegDebrief: Identifiable, Sendable, Equatable {
    var id: String { "\(fromCode)-\(toCode)-\(startTime.timeIntervalSinceReferenceDate)" }
    let fromCode: String
    let toCode: String
    /// Published altitude for the direction flown, verbatim ("2500" or "2500/3500"); nil when CAAI publishes none.
    let publishedAltitude: String?
    let startTime: Date
    let endTime: Date
    /// nil when every point fell inside the aerodrome exclusion zones or no altitude is published.
    let adherence: CVFRAltitudeAdherence?
    /// Where the leg starts and ends on the debrief's distance axis: cumulative along the matched legs -- nautical miles.
    var startDistanceNM: Double = 0
    var endDistanceNM: Double = 0
}

/// Time-weighted altitude adherence on one leg, outside the 3 NM aerodrome exclusion zones.
nonisolated struct CVFRAltitudeAdherence: Sendable, Equatable {
    /// Share of the leg's time (0...1) flown within ±200 ft / ±300 ft of the published altitude.
    let fractionWithin200: Double
    let fractionWithin300: Double
    /// The largest deviation, signed: positive = above the published altitude -- feet.
    let maxDeviationFeet: Double
    /// Seconds of track that counted (after the exclusion zones).
    let sampledSeconds: TimeInterval
}

/// Passage of one reporting point on the route.
nonisolated struct CVFRPointPassage: Identifiable, Sendable, Equatable {
    /// Unique per visit: an out-and-back route passes the same point twice.
    var id: String { "\(code)-\(time.timeIntervalSinceReferenceDate)" }
    let code: String
    let nameEnglish: String?
    let nameHebrew: String?
    /// Time of closest approach.
    let time: Date
    /// Closest distance -- nautical miles.
    let distanceNM: Double
    /// A transcript segment within ±2 min of `time` named the point (code, English or Hebrew name).
    let reported: Bool
    /// Where the point sits on the debrief's distance axis (a leg boundary) -- nautical miles. nil when built outside
    /// `CVFRDebriefBuilder.build`.
    var distanceAlongRouteNM: Double? = nil
    /// When the report naming the point was heard (the first matching transcript segment); nil when not heard.
    var reportTime: Date? = nil
}

/// One track point on the debrief's distance axis.
nonisolated struct CVFRProfileSample: Sendable, Equatable {
    /// Along the matched legs, cumulative over legs -- nautical miles. Never decreases: an orbit stacks at one
    /// distance instead of running the trace backwards.
    let distanceNM: Double
    /// Feet MSL.
    let altitudeFeet: Double
    /// Index into `CVFRDebrief.legs`.
    let legIndex: Int
    /// Inside the 3 NM aerodrome zone of the leg: not scored.
    let excluded: Bool
    let time: Date
}

/// A scored stretch of the profile flown outside ±200 ft of the published altitude, on one leg, one side.
nonisolated struct CVFRAltitudeExcursion: Sendable, Equatable {
    let legIndex: Int
    /// Indices into `CVFRDebrief.profile`.
    var sampleRange: ClosedRange<Int>
    /// The largest deviation in the stretch, signed: positive = above -- feet.
    var deviationFeet: Double
    var startTime: Date
    var endTime: Date

    /// Seconds.
    var seconds: TimeInterval { endTime.timeIntervalSince(startTime) }
}

/// The CVFR section of a flight debrief. `legs` is empty when the track never came within 1 NM of a route.
nonisolated struct CVFRDebrief: Sendable, Equatable {
    /// true when the legs came from the plan activated for the flight, false when matched from the track alone.
    let fromPlan: Bool
    let legs: [CVFRLegDebrief]
    let points: [CVFRPointPassage]
    /// 2-3 plain-language observations, generated from the numbers above.
    let observations: [String]
    /// false when the flight has no transcript segments: position reports were then not checked, which is not the
    /// same as "not heard".
    var transcriptAvailable: Bool = true
    /// The flown altitude on the distance axis, for the unrolled debrief.
    var profile: [CVFRProfileSample] = []

    var isEmpty: Bool { legs.isEmpty }
}

// MARK: - Matching input

/// A route leg to match the track against: a segment flown in one direction.
nonisolated struct CVFRRouteLeg: Sendable, Equatable {
    let segment: IsraelRouteSegment
    let forward: Bool

    var fromCode: String { forward ? segment.fromCode : segment.toCode }
    var toCode: String { forward ? segment.toCode : segment.fromCode }
    /// Polyline in the direction flown.
    var polyline: [CLLocationCoordinate2D] { forward ? segment.polyline : segment.polyline.reversed() }
    var publishedAltitude: String? { segment.altitude(forward: forward)?.published }
}

/// A run of consecutive track points on one leg.
nonisolated struct CVFRMatchedLeg: Sendable {
    let leg: CVFRRouteLeg
    let points: [TrackPointRecord]
}

// MARK: - Builder

nonisolated enum CVFRDebriefBuilder {

    /// A track point counts as on a route when within this distance of its polyline -- nautical miles.
    static let matchRadiusNM = 1.0
    /// Track within this distance of an aerodrome endpoint is excluded from the altitude maths -- nautical miles.
    static let aerodromeExclusionNM = 3.0
    /// Reporting tolerance bands -- feet.
    static let tightBandFeet = 200.0
    static let wideBandFeet = 300.0
    /// A transcript segment counts as a position report within this window of the closest approach -- seconds.
    /// The built-in value; `RemoteParameter.cvfrReportWindowSeconds` can move it inside its range.
    static let reportWindowSeconds: TimeInterval = 120
    /// Gaps between samples longer than this are not credited to the earlier sample -- seconds.
    static let maxSampleWeightSeconds: TimeInterval = 10
    /// Unplanned matching ignores runs shorter than this (route crossings, GPS noise) -- seconds.
    static let minimumRunSeconds: TimeInterval = 30

    // MARK: Entry point

    /// Full debrief. `plannedLegs` are the activated plan's legs when the flight had one; otherwise the
    /// track is matched to `segments` (the whole network). `points` resolves the reporting points by code.
    /// `reportWindow` is the position-report window -- seconds.
    static func build(
        trackPoints: [TrackPointRecord],
        transcript: [TranscriptSegmentRecord],
        plannedLegs: [CVFRRouteLeg]?,
        segments: [IsraelRouteSegment],
        points: [String: IsraelReportingPoint],
        reportWindow: TimeInterval = reportWindowSeconds
    ) -> CVFRDebrief {
        let matched: [CVFRMatchedLeg]
        if let plannedLegs, !plannedLegs.isEmpty {
            matched = matchPlanned(trackPoints: trackPoints, legs: plannedLegs)
        } else {
            matched = matchUnplanned(trackPoints: trackPoints, segments: segments)
        }
        var legs: [CVFRLegDebrief] = []
        var profile: [CVFRProfileSample] = []
        profile.reserveCapacity(matched.reduce(0) { $0 + $1.points.count })
        var furthest = 0.0   // NM along the route
        for (index, run) in matched.enumerated() {
            let leg = legDebrief(for: run, startDistanceNM: legs.last?.endDistanceNM ?? 0)
            legs.append(leg)
            let polyline = run.leg.polyline
            let zones = aerodromeEnds(of: run.leg, polyline: polyline)
            for point in run.points {
                let coordinate = CLLocationCoordinate2D(latitude: point.latitude, longitude: point.longitude)
                // Clamped to the leg, so the axis never runs backwards across a leg boundary either.
                furthest = max(furthest, leg.startDistanceNM + alongTrackNM(of: coordinate, polyline: polyline))
                profile.append(CVFRProfileSample(
                    distanceNM: furthest,
                    altitudeFeet: point.altitudeFeet,
                    legIndex: index,
                    excluded: isInAerodromeZone(coordinate, zones: zones),
                    time: point.timestamp
                ))
            }
        }

        let passages = routeStops(of: legs).compactMap { stop -> CVFRPointPassage? in
            guard let point = points[stop.code],
                  var found = passage(of: point, trackPoints: trackPoints, transcript: transcript,
                                      reportWindow: reportWindow, during: stop.window)
            else { return nil }
            found.distanceAlongRouteNM = stop.distanceNM
            return found
        }

        return CVFRDebrief(
            fromPlan: plannedLegs.map { !$0.isEmpty } ?? false,
            legs: legs,
            points: passages,
            observations: observations(legs: legs, points: passages, transcriptAvailable: !transcript.isEmpty),
            transcriptAvailable: !transcript.isEmpty,
            profile: profile
        )
    }

    // MARK: Route matching

    /// A point within this much of the nearest leg's distance may belong to a later leg: at a junction the
    /// aircraft has reached the start of the next leg -- nautical miles.
    static let junctionToleranceNM = 0.01

    /// Match the track to the plan's legs in order: each point goes to the nearest leg (within 1 NM) at or
    /// after the leg the previous point was on, so a route that doubles back over itself stays in sequence.
    static func matchPlanned(trackPoints: [TrackPointRecord], legs: [CVFRRouteLeg]) -> [CVFRMatchedLeg] {
        guard !legs.isEmpty else { return [] }
        var runs: [(index: Int, points: [TrackPointRecord])] = []
        var cursor = 0
        for point in trackPoints {
            let coordinate = CLLocationCoordinate2D(latitude: point.latitude, longitude: point.longitude)
            // Prefer the current or next leg; look further ahead only when neither is within range
            // (a gap in the track skipped a whole leg).
            func within(_ range: Range<Int>) -> [(index: Int, distance: Double)] {
                range.compactMap { index in
                    let distance = distanceNM(from: coordinate, toPolyline: legs[index].polyline)
                    return distance <= matchRadiusNM ? (index, distance) : nil
                }
            }
            var candidates = within(cursor..<min(legs.count, cursor + 2))
            if candidates.isEmpty { candidates = within(cursor..<legs.count) }
            // Nearest leg; at a junction (within `junctionToleranceNM` of the best) the later leg wins.
            guard let nearest = candidates.map(\.distance).min(),
                  let best = candidates.filter({ $0.distance <= nearest + junctionToleranceNM }).max(by: { $0.index < $1.index })
            else { continue }
            cursor = best.index
            if let last = runs.last, last.index == best.index {
                runs[runs.count - 1].points.append(point)
            } else {
                runs.append((best.index, [point]))
            }
        }
        return runs.map { CVFRMatchedLeg(leg: legs[$0.index], points: $0.points) }
    }

    /// Match the track to the nearest segment within 1 NM, in the direction the aircraft was moving along it.
    /// Runs shorter than `minimumRunSeconds` are dropped (crossing another route, GPS scatter) and
    /// neighbouring runs on the same leg are merged.
    static func matchUnplanned(trackPoints: [TrackPointRecord], segments: [IsraelRouteSegment]) -> [CVFRMatchedLeg] {
        guard !segments.isEmpty else { return [] }
        var runs: [CVFRMatchedLeg] = []
        var previous: TrackPointRecord?
        for point in trackPoints {
            defer { previous = point }
            let coordinate = CLLocationCoordinate2D(latitude: point.latitude, longitude: point.longitude)
            var best: (segment: IsraelRouteSegment, distance: Double, forward: Bool)?
            for segment in segments {
                let (distance, bearing) = nearestEdge(from: coordinate, polyline: segment.polyline)
                guard distance <= matchRadiusNM, distance < (best?.distance ?? .infinity) else { continue }
                let course = trackCourse(of: point, previous: previous)
                let forward = course.map { angularDifference($0, bearing) <= 90 } ?? true
                best = (segment, distance, forward)
            }
            guard let best else { continue }
            let leg = CVFRRouteLeg(segment: best.segment, forward: best.forward)
            if let last = runs.last, last.leg == leg {
                runs[runs.count - 1] = CVFRMatchedLeg(leg: leg, points: last.points + [point])
            } else {
                runs.append(CVFRMatchedLeg(leg: leg, points: [point]))
            }
        }

        let kept = runs.filter { run in
            guard let first = run.points.first, let last = run.points.last else { return false }
            return last.timestamp.timeIntervalSince(first.timestamp) >= minimumRunSeconds
        }
        var merged: [CVFRMatchedLeg] = []
        for run in kept {
            if let last = merged.last, last.leg == run.leg {
                merged[merged.count - 1] = CVFRMatchedLeg(leg: run.leg, points: last.points + run.points)
            } else {
                merged.append(run)
            }
        }
        return merged
    }

    /// The reporting points along the debriefed legs, in order, without repeats of consecutive codes, each at its
    /// leg boundary on the distance axis -- nautical miles. `window` spans the legs that touch the stop (from the
    /// start of the leg arriving there to the end of the leg leaving it; open-ended before the first leg and after
    /// the last), so a point visited twice (out and back) gets one passage per visit.
    static func routeStops(of legs: [CVFRLegDebrief]) -> [(code: String, distanceNM: Double, window: ClosedRange<Date>)] {
        var stops: [(code: String, distanceNM: Double, window: ClosedRange<Date>)] = []
        for (index, leg) in legs.enumerated() {
            if let last = stops.last, last.code == leg.fromCode {
                stops[stops.count - 1].window = last.window.lowerBound...max(last.window.upperBound, leg.endTime)
            } else {
                let lower = index == 0 ? Date.distantPast : leg.startTime
                stops.append((leg.fromCode, leg.startDistanceNM, lower...leg.endTime))
            }
            let upper = index == legs.count - 1 ? Date.distantFuture : leg.endTime
            stops.append((leg.toCode, leg.endDistanceNM, leg.startTime...upper))
        }
        return stops
    }

    // MARK: Altitude adherence

    /// `startDistanceNM` places the leg on the distance axis; it ends one polyline length later -- nautical miles.
    static func legDebrief(for matched: CVFRMatchedLeg, startDistanceNM: Double = 0) -> CVFRLegDebrief {
        let start = matched.points.first?.timestamp ?? Date.distantPast
        let end = matched.points.last?.timestamp ?? start
        let published = matched.leg.publishedAltitude
        return CVFRLegDebrief(
            fromCode: matched.leg.fromCode,
            toCode: matched.leg.toCode,
            publishedAltitude: published,
            startTime: start,
            endTime: end,
            adherence: published.flatMap { adherence(points: matched.points, leg: matched.leg, publishedText: $0) },
            startDistanceNM: startDistanceNM,
            endDistanceNM: startDistanceNM + IsraelRoutePlanner.length(of: matched.leg.polyline)
        )
    }

    /// Time-weighted adherence of `points` to `publishedText` on `leg`; points within 3 NM of an aerodrome
    /// endpoint are excluded. nil when nothing is left to measure or the text has no number.
    static func adherence(points: [TrackPointRecord], leg: CVFRRouteLeg, publishedText: String) -> CVFRAltitudeAdherence? {
        let published = publishedAltitudes(publishedText)
        guard !published.isEmpty else { return nil }
        let zones = aerodromeEnds(of: leg, polyline: leg.polyline)
        let sampled = points.filter { point in
            !isInAerodromeZone(CLLocationCoordinate2D(latitude: point.latitude, longitude: point.longitude), zones: zones)
        }
        return adherence(samples: sampled, published: published)
    }

    /// The leg's aerodrome endpoints (none where both ends are route points). `polyline` is `leg.polyline`, passed
    /// in so a reversed leg is not reversed again per point.
    static func aerodromeEnds(of leg: CVFRRouteLeg, polyline: [CLLocationCoordinate2D]) -> [CLLocationCoordinate2D] {
        var ends: [CLLocationCoordinate2D] = []
        if isAerodromeCode(leg.fromCode), let first = polyline.first { ends.append(first) }
        if isAerodromeCode(leg.toCode), let last = polyline.last { ends.append(last) }
        return ends
    }

    /// Within 3 NM of one of `zones` (aerodrome endpoints): not scored.
    static func isInAerodromeZone(_ coordinate: CLLocationCoordinate2D, zones: [CLLocationCoordinate2D]) -> Bool {
        zones.contains { IsraelRoutePlanner.haversineNM(coordinate, $0) < aerodromeExclusionNM }
    }

    /// Core maths: each sample is weighted by the time to the next sample (capped), and compared against the
    /// nearer published altitude.
    static func adherence(samples: [TrackPointRecord], published: [Double]) -> CVFRAltitudeAdherence? {
        guard !samples.isEmpty, !published.isEmpty else { return nil }
        var total = 0.0, within200 = 0.0, within300 = 0.0
        var maxDeviation = 0.0
        for (index, sample) in samples.enumerated() {
            let weight: TimeInterval
            if index + 1 < samples.count {
                weight = min(maxSampleWeightSeconds, max(0, samples[index + 1].timestamp.timeIntervalSince(sample.timestamp)))
            } else {
                weight = 1
            }
            let deviation = deviationFeet(altitude: sample.altitudeFeet, published: published)
            total += weight
            if abs(deviation) <= tightBandFeet { within200 += weight }
            if abs(deviation) <= wideBandFeet { within300 += weight }
            if abs(deviation) > abs(maxDeviation) { maxDeviation = deviation }
        }
        guard total > 0 else { return nil }
        return CVFRAltitudeAdherence(
            fractionWithin200: within200 / total,
            fractionWithin300: within300 / total,
            maxDeviationFeet: maxDeviation,
            sampledSeconds: total
        )
    }

    /// Signed deviation from the nearer published altitude -- feet.
    static func deviationFeet(altitude: Double, published: [Double]) -> Double {
        var best = altitude - published[0]
        for value in published.dropFirst() where abs(altitude - value) < abs(best) {
            best = altitude - value
        }
        return best
    }

    /// "2500" -> [2500]; "2500/3500" -> [2500, 3500]. Feet MSL.
    static func publishedAltitudes(_ text: String) -> [Double] {
        text.split(whereSeparator: { !$0.isNumber }).compactMap { Double($0) }
    }

    /// Aerodrome endpoints carry the ICAO code (LLxx); route points carry five-letter codes.
    static func isAerodromeCode(_ code: String) -> Bool {
        code.count == 4 && code.uppercased().hasPrefix("LL")
    }

    // MARK: Reporting points

    /// Closest approach to `point` among the track points timed inside `window`, and whether a report naming it
    /// was heard within `reportWindow` seconds of that time.
    static func passage(
        of point: IsraelReportingPoint,
        trackPoints: [TrackPointRecord],
        transcript: [TranscriptSegmentRecord],
        reportWindow: TimeInterval = reportWindowSeconds,
        during window: ClosedRange<Date> = Date.distantPast...Date.distantFuture
    ) -> CVFRPointPassage? {
        var closest: (time: Date, distance: Double)?
        for sample in trackPoints where window.contains(sample.timestamp) {
            let coordinate = CLLocationCoordinate2D(latitude: sample.latitude, longitude: sample.longitude)
            let distance = IsraelRoutePlanner.haversineNM(coordinate, point.coordinate)
            if distance < (closest?.distance ?? .infinity) { closest = (sample.timestamp, distance) }
        }
        guard let closest else { return nil }
        let report = transcript.first { segment in
            abs(segment.timestamp.timeIntervalSince(closest.time)) <= reportWindow
                && TranscriptTextMatcher.mentions(point: point, in: segment.text)
        }
        return CVFRPointPassage(
            code: point.code,
            nameEnglish: point.nameEnglish,
            nameHebrew: point.nameHebrew,
            time: closest.time,
            distanceNM: closest.distance,
            reported: report != nil,
            reportTime: report?.timestamp
        )
    }

    // MARK: Observations

    /// 2-3 plain-language sentences about the numbers. Empty when no leg matched.
    static func observations(legs: [CVFRLegDebrief], points: [CVFRPointPassage], transcriptAvailable: Bool = true) -> [String] {
        guard !legs.isEmpty else { return [] }
        var lines: [String] = []
        let measured = legs.compactMap { leg -> (CVFRLegDebrief, CVFRAltitudeAdherence)? in
            leg.adherence.map { (leg, $0) }
        }
        if measured.isEmpty {
            lines.append("No leg had enough track outside the aerodrome zones to measure altitude.")
        } else {
            let totalSeconds = measured.reduce(0) { $0 + $1.1.sampledSeconds }
            let within200 = measured.reduce(0) { $0 + $1.1.fractionWithin200 * $1.1.sampledSeconds } / totalSeconds
            let within300 = measured.reduce(0) { $0 + $1.1.fractionWithin300 * $1.1.sampledSeconds } / totalSeconds
            lines.append("Altitude was within ±200 ft of the published altitude for \(percent(within200)) of the route and within ±300 ft for \(percent(within300)).")

            if let worst = measured.min(by: { $0.1.fractionWithin200 < $1.1.fractionWithin200 }) {
                let (leg, adherence) = worst
                let direction = adherence.maxDeviationFeet >= 0 ? "above" : "below"
                let published = leg.publishedAltitude ?? "---"
                if adherence.fractionWithin200 >= 0.9 {
                    lines.append("Every leg held altitude well; the largest deviation was \(Int(abs(adherence.maxDeviationFeet).rounded())) ft \(direction) \(published) ft on \(leg.fromCode)–\(leg.toCode).")
                } else {
                    lines.append("\(leg.fromCode)–\(leg.toCode) was the weakest leg: \(percent(adherence.fractionWithin200)) within ±200 ft of \(published) ft, up to \(Int(abs(adherence.maxDeviationFeet).rounded())) ft \(direction).")
                }
            }
        }

        let reportable = points.filter { !isAerodromeCode($0.code) }
        if !transcriptAvailable {
            // Nothing was transcribed (recording off, no speech recognised, or transcription failed): the radio
            // was not checked. Never turn "not transcribed" into "not heard".
            if !reportable.isEmpty {
                lines.append("No cockpit audio was transcribed, so position reports could not be checked.")
            }
        } else if !reportable.isEmpty {
            let missed = reportable.filter { !$0.reported }
            if missed.isEmpty {
                lines.append("A position report was heard at all \(reportable.count) reporting points.")
            } else {
                let names = missed.map(\.code).joined(separator: ", ")
                lines.append("Position reports were heard at \(reportable.count - missed.count) of \(reportable.count) reporting points; none heard near \(names).")
            }
        }
        return Array(lines.prefix(3))
    }

    static func percent(_ fraction: Double) -> String {
        "\(Int((fraction * 100).rounded()))%"
    }

    // MARK: Excursions

    /// The scored stretches of `debrief.profile` outside ±200 ft of the leg's published altitude, in order. A stretch
    /// ends at a sample back inside the band, an excluded sample, a new leg, a change of side, or a gap in the
    /// track longer than `maxSampleWeightSeconds` (no data is not time outside the band).
    static func excursions(in debrief: CVFRDebrief) -> [CVFRAltitudeExcursion] {
        let published = debrief.legs.map { $0.publishedAltitude.map(publishedAltitudes) ?? [] }
        var result: [CVFRAltitudeExcursion] = []
        var open: CVFRAltitudeExcursion?
        for (index, sample) in debrief.profile.enumerated() {
            if index > 0, sample.time.timeIntervalSince(debrief.profile[index - 1].time) > maxSampleWeightSeconds {
                if let current = open { result.append(current) }
                open = nil
            }
            let reference = published.indices.contains(sample.legIndex) ? published[sample.legIndex] : []
            let deviation = reference.isEmpty || sample.excluded ? 0 : deviationFeet(altitude: sample.altitudeFeet, published: reference)
            guard abs(deviation) > tightBandFeet else {
                if let current = open { result.append(current) }
                open = nil
                continue
            }
            if var current = open, current.legIndex == sample.legIndex, (current.deviationFeet > 0) == (deviation > 0) {
                current.sampleRange = current.sampleRange.lowerBound...index
                current.endTime = sample.time
                if abs(deviation) > abs(current.deviationFeet) { current.deviationFeet = deviation }
                open = current
            } else {
                if let current = open { result.append(current) }
                open = CVFRAltitudeExcursion(
                    legIndex: sample.legIndex, sampleRange: index...index, deviationFeet: deviation,
                    startTime: sample.time, endTime: sample.time
                )
            }
        }
        if let current = open { result.append(current) }
        return result
    }

    // MARK: Prompt facts

    /// The CVFR facts for `FlightSummaryBuilder`, so the AI debrief can mention them without inventing numbers.
    static func promptFacts(_ debrief: CVFRDebrief) -> String? {
        guard !debrief.isEmpty else { return nil }
        let timeFormatter = DateFormatter()
        timeFormatter.dateFormat = "HH:mm"
        timeFormatter.timeZone = TimeZone(identifier: "UTC")
        var lines = ["[CVFR ROUTE] Israel CVFR route \(debrief.fromPlan ? "(planned)" : "(matched from track)"). Altitudes feet MSL."]
        for leg in debrief.legs {
            var line = "Leg \(leg.fromCode)-\(leg.toCode) published \(leg.publishedAltitude ?? "none")"
            if let a = leg.adherence {
                line += ": \(percent(a.fractionWithin200)) within 200ft, \(percent(a.fractionWithin300)) within 300ft, max deviation \(Int(a.maxDeviationFeet.rounded()))ft"
            } else {
                line += ": not measured"
            }
            lines.append(line)
        }
        for point in debrief.points {
            let report = debrief.transcriptAvailable ? (point.reported ? "heard" : "not heard") : "not checked (no transcript)"
            lines.append("Point \(point.code) \(timeFormatter.string(from: point.time))Z closest \(String(format: "%.1f", point.distanceNM))NM, position report \(report)")
        }
        return lines.joined(separator: "\n")
    }

    // MARK: Geometry (nautical miles, equirectangular around the query point)

    /// Distance from a point to a polyline -- nautical miles.
    static func distanceNM(from point: CLLocationCoordinate2D, toPolyline polyline: [CLLocationCoordinate2D]) -> Double {
        nearestEdge(from: point, polyline: polyline).distance
    }

    /// The nearest polyline edge: its distance (NM) and bearing (degrees true, in polyline order).
    static func nearestEdge(from point: CLLocationCoordinate2D, polyline: [CLLocationCoordinate2D]) -> (distance: Double, bearing: Double) {
        let edge = nearestEdgeProjection(from: point, polyline: polyline)
        return (edge.distance, edge.bearing)
    }

    /// How far along `polyline` the point projects onto its nearest edge, 0...polyline length -- nautical miles.
    static func alongTrackNM(of point: CLLocationCoordinate2D, polyline: [CLLocationCoordinate2D]) -> Double {
        let edge = nearestEdgeProjection(from: point, polyline: polyline)
        guard edge.index + 1 < polyline.count else { return 0 }
        let before = (0..<edge.index).reduce(0.0) { $0 + IsraelRoutePlanner.haversineNM(polyline[$1], polyline[$1 + 1]) }
        return before + edge.fraction * IsraelRoutePlanner.haversineNM(polyline[edge.index], polyline[edge.index + 1])
    }

    /// The nearest edge's distance (NM), bearing (degrees true), index (its first vertex) and the projection's
    /// fraction along it (0...1).
    private static func nearestEdgeProjection(
        from point: CLLocationCoordinate2D, polyline: [CLLocationCoordinate2D]
    ) -> (distance: Double, bearing: Double, index: Int, fraction: Double) {
        guard let first = polyline.first else { return (.infinity, 0, 0, 0) }
        if polyline.count == 1 { return (IsraelRoutePlanner.haversineNM(point, first), 0, 0, 0) }
        let cosLat = cos(point.latitude * .pi / 180)
        func project(_ c: CLLocationCoordinate2D) -> (x: Double, y: Double) {
            ((c.longitude - point.longitude) * 60 * cosLat, (c.latitude - point.latitude) * 60)
        }
        var best: (distance: Double, bearing: Double, index: Int, fraction: Double) = (.infinity, 0, 0, 0)
        for (index, (a, b)) in zip(polyline, polyline.dropFirst()).enumerated() {
            let pa = project(a), pb = project(b)
            let dx = pb.x - pa.x, dy = pb.y - pa.y
            let lengthSquared = dx * dx + dy * dy
            let t = lengthSquared > 0 ? max(0, min(1, -(pa.x * dx + pa.y * dy) / lengthSquared)) : 0
            let cx = pa.x + t * dx, cy = pa.y + t * dy
            let distance = (cx * cx + cy * cy).squareRoot()
            if distance < best.distance {
                let bearing = (atan2(dx, dy) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
                best = (distance, bearing, index, t)
            }
        }
        return best
    }

    /// Course over ground -- degrees true: the recorded course, else the bearing from the previous sample.
    static func trackCourse(of point: TrackPointRecord, previous: TrackPointRecord?) -> Double? {
        if point.courseDegrees >= 0, point.groundSpeedKnots > 5 { return point.courseDegrees }
        guard let previous else { return nil }
        let cosLat = cos(point.latitude * .pi / 180)
        let dx = (point.longitude - previous.longitude) * cosLat
        let dy = point.latitude - previous.latitude
        guard dx != 0 || dy != 0 else { return nil }
        return (atan2(dx, dy) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
    }

    /// Smallest angle between two bearings -- degrees, 0...180.
    static func angularDifference(_ a: Double, _ b: Double) -> Double {
        let diff = abs(a - b).truncatingRemainder(dividingBy: 360)
        return diff > 180 ? 360 - diff : diff
    }
}

// MARK: - Verdict

/// The one line above the unrolled debrief: at most two findings to look at, never an overall score.
nonisolated enum CVFRDebriefVerdict {
    /// A leg is low when less than this share of its measured time was within ±300 ft (the table's amber rule).
    static let lowLegFraction = 0.8
    static let maximumFindings = 2

    /// Low legs (worst first) and points whose report was not heard (aerodromes are not reporting points; nothing
    /// is "not heard" without a transcript). The worst leg and the first missed report come first, so two findings
    /// of different kinds both show.
    static func findings(_ debrief: CVFRDebrief) -> [String] {
        let excursions = CVFRDebriefBuilder.excursions(in: debrief)
        let lowLegs = debrief.legs.indices
            .compactMap { index -> (index: Int, adherence: CVFRAltitudeAdherence)? in
                guard let adherence = debrief.legs[index].adherence, adherence.fractionWithin300 < lowLegFraction else { return nil }
                return (index, adherence)
            }
            .sorted { $0.adherence.fractionWithin300 < $1.adherence.fractionWithin300 }
            .map { low in legFinding(debrief.legs[low.index], adherence: low.adherence, excursions: excursions.filter { $0.legIndex == low.index }) }
        let notHeard = debrief.transcriptAvailable
            ? debrief.points.filter { !$0.reported && !CVFRDebriefBuilder.isAerodromeCode($0.code) }.map { "\($0.code) report not heard" }
            : []
        let firsts = [lowLegs.first, notHeard.first].compactMap { $0 }
        let rest = lowLegs.dropFirst() + notHeard.dropFirst()
        // A point passed twice (out and back) and missed both times is one finding, not two.
        var seen = Set<String>()
        return Array((firsts + rest).filter { seen.insert($0).inserted }.prefix(maximumFindings))
    }

    /// "TAVOR to DESHE: 330 ft low, 4 min" from the leg's longest excursion; the ±300 ft share when it has none.
    static func legFinding(_ leg: CVFRLegDebrief, adherence: CVFRAltitudeAdherence, excursions: [CVFRAltitudeExcursion]) -> String {
        let name = "\(leg.fromCode) to \(leg.toCode)"
        guard let longest = longest(excursions) else {
            return "\(name): \(CVFRDebriefBuilder.percent(adherence.fractionWithin300)) within 300 ft"
        }
        return "\(name): \(deviationText(longest.deviationFeet)), \(durationText(longest.seconds))"
    }

    /// The excursion that lasted longest; the larger deviation breaks a tie.
    static func longest(_ excursions: [CVFRAltitudeExcursion]) -> CVFRAltitudeExcursion? {
        excursions.max { ($0.seconds, abs($0.deviationFeet)) < ($1.seconds, abs($1.deviationFeet)) }
    }

    /// "330 ft low" / "250 ft high". Feet.
    static func deviationText(_ deviationFeet: Double) -> String {
        "\(Int(abs(deviationFeet).rounded())) ft \(deviationFeet < 0 ? "low" : "high")"
    }

    /// "4 min" from a minute up, "45 s" below. Seconds.
    static func durationText(_ seconds: TimeInterval) -> String {
        seconds >= 60 ? "\(Int((seconds / 60).rounded())) min" : "\(Int(seconds.rounded())) s"
    }

    static func headline(count: Int) -> String {
        switch count {
        case 0: "Nothing to look at."
        case 1: "One thing to look at."
        default: "Two things to look at."
        }
    }
}
