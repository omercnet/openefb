//
//  IsraelAerodromeAdapter.swift
//  efb-212
//
//  Maps the curated Israeli aerodromes (IL-4, israel-aviation.sqlite) onto the `Airport` model the
//  NRST list, search, Direct-To and airport sheet already use, and finds NOTAMs that name a field closed.
//
//  Pure, nonisolated logic (testable off the main actor).
//

import Foundation
import CoreLocation

// MARK: - Flags

/// What the pilot must know about an Israeli field beyond what `Airport` carries.
nonisolated struct IsraelAerodromeFlags: Equatable, Sendable {
    /// The AIP says prior permission is required (PPR), or the field is an operator-run strip.
    let requiresPPR: Bool
    /// Ids of current NOTAMs that name this field closed (empty when none found or the feed is unusable).
    let closureNotamIDs: [String]
    /// The owner has checked the data against the AIP.
    let isReviewed: Bool

    var isClosedByNotam: Bool { !closureNotamIDs.isEmpty }
}

// MARK: - Adapter

nonisolated enum IsraelAerodromeAdapter {

    /// Fields NRST never offers: unmanned-aircraft strips (no manned landings without CAAI approval),
    /// ultralight-only strips (LLRS Rishon LeZion, LLEV Ein Vered: not for conventional GA aircraft) and
    /// fields outside Israel. Heliports are dropped by `LandableAirportFilter`; fields with no runway
    /// data (agricultural strips) and military fields with unpublished surfaces fall out of it as well.
    static let notLandableUses: Set<IsraelAerodromeUse> = [.uas, .ultralight, .foreign]

    static func airport(_ aerodrome: IsraelAerodrome) -> Airport {
        Airport(
            icao: aerodrome.code,
            name: aerodrome.nameEnglish,
            latitude: aerodrome.latitude,        // degrees
            longitude: aerodrome.longitude,      // degrees
            elevation: Double(aerodrome.elevationFeet ?? 0),   // feet MSL; the sheet shows "unpublished" via the aerodrome
            type: aerodrome.type == .heliport ? .heliport : .airport,
            ownership: aerodrome.use == .military ? .military : .publicOwned,
            runways: aerodrome.runways.map { runway(from: $0, at: aerodrome) },
            frequencies: aerodrome.frequencies.compactMap(frequency)
        )
    }

    /// The AIP gives no runway-end coordinates, so both ends sit on the reference point; nothing draws them.
    static func runway(from runway: IsraelAerodromeRunway, at aerodrome: IsraelAerodrome) -> Runway {
        let ends = runway.designator.split(separator: "/", maxSplits: 1).map(String.init)
        return Runway(
            id: runway.designator,
            length: runway.lengthFeet,       // feet
            width: runway.widthFeet,         // feet
            surface: surface(runway.surface),
            lighting: .none,
            baseEndID: ends.first ?? runway.designator,
            reciprocalEndID: ends.count > 1 ? ends[1] : "",
            baseEndLatitude: aerodrome.latitude, baseEndLongitude: aerodrome.longitude,
            reciprocalEndLatitude: aerodrome.latitude, reciprocalEndLongitude: aerodrome.longitude
        )
    }

    static func surface(_ text: String) -> SurfaceType {
        // Composite surfaces as published ("concrete+asphalt", "asphalt/concrete") map to their first part.
        switch text.split(whereSeparator: { $0 == "+" || $0 == "/" }).first.map(String.init) ?? text {
        case "asphalt": return .asphalt
        case "concrete": return .concrete
        case "grass": return .turf
        case "gravel": return .gravel
        case "dirt": return .dirt
        default: return .other
        }
    }

    /// Frequencies with a MHz value; the role comes from the AIP's wording ("TWR primary", "Airstrip operator channel").
    static func frequency(_ source: IsraelAerodromeFrequency) -> Frequency? {
        guard let mhz = source.megahertz else { return nil }
        let name = source.callsignHebrew.map { "\(source.service) (\($0))" } ?? source.service
        return Frequency(type: frequencyType(service: source.service), frequency: mhz, name: name)
    }

    static func frequencyType(service: String) -> FrequencyType {
        let s = service.lowercased()
        if s.contains("atis") { return .atis }
        if s.hasPrefix("twr") || s.contains("tower") { return .tower }
        if s.hasPrefix("gnd") || s.contains("ground") { return .ground }
        if s.hasPrefix("clr") || s.contains("clearance") { return .clearance }
        if s.hasPrefix("app") || s.contains("approach") || s.hasPrefix("tma") { return .approach }
        if s.contains("operator") || s.contains("a/g") || s.contains("helipad frequency") { return .ctaf }
        return .other
    }

    // MARK: Flags

    static func flags(for aerodrome: IsraelAerodrome, report: IsraelNotamReport?, now: Date = Date()) -> IsraelAerodromeFlags {
        let closures = report.map { closingNotams(naming: aerodrome.code, in: $0, at: now).map(\.id) } ?? []
        return IsraelAerodromeFlags(requiresPPR: aerodrome.ppr == .yes, closureNotamIDs: closures, isReviewed: aerodrome.isReviewed)
    }

    /// NOTAMs in a usable feed that close the field itself: not superseded, valid now, not a route closure
    /// ("RTE CLSD" chains are mapped by `IsraelNotamClosureMapper`), and E) saying the aerodrome is closed:
    /// "LLBO AIRSTRIP CLSD TO ALL FLT", "LLHZ AD CLSD", "AD LLHZ CLSD". The code must be the subject of CLSD.
    /// Area closures that merely mention the code ("UAS ACT WI LLHZ TRG AREA ... AN AREA BTN FLW PSN CLSD")
    /// and runway or taxiway closures do not match: a red tag must mean the field is shut.
    /// A feed that is expired or unsafe by age yields nothing: an old closure set never reads as current.
    static func closingNotams(naming code: String, in report: IsraelNotamReport, at date: Date) -> [IsraelNotam] {
        switch report.freshness(now: date).level {
        case .fresh, .old: break
        case .unknown, .expired, .unsafe: return []
        }
        let c = NSRegularExpression.escapedPattern(for: code)
        let kind = "(?:AD|AIRSTRIP|AERODROME|AIRPORT|HELIPORT|HELIPAD)"
        let closed = "(?:IS\\s+)?(?:CLSD|CLOSED)"
        let patterns = [
            "\\b\(c)\\s+(?:\(kind)\\s+)?\(closed)\\b",      // LLBO AIRSTRIP CLSD, LLHZ CLSD
            "\\b\(kind)\\s+\(c)\\s+\(closed)\\b",           // AD LLHZ CLSD
        ].compactMap { try? NSRegularExpression(pattern: $0) }
        guard !patterns.isEmpty else { return [] }
        return report.feed.items.filter { notam in
            guard !notam.isSuperseded, notam.closures.isEmpty else { return false }
            if let from = notam.validFrom, date < from { return false }
            if let to = notam.validTo, date > to { return false }
            guard let text = notam.e?.uppercased() else { return false }
            let range = NSRange(text.startIndex..., in: text)
            return patterns.contains { $0.firstMatch(in: text, range: range) != nil }
        }
    }
}
