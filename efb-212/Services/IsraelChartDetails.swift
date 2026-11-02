//
//  IsraelChartDetails.swift
//  efb-212
//
//  What the CVFR tap sheets show (IL-3): pure value types built from the CAAI models. Published
//  text is always preserved ("2500/3500", "3000/3500"), and altitude references that IL-1
//  inferred (the layers carry none) are labelled as inferred, for the CFI review (IL-12).
//

import Foundation

nonisolated struct IsraelRouteAltitudeRow: Equatable, Sendable, Identifiable {
    var id: String { "\(segmentID)-\(from)-\(to)" }
    let segmentID: Int
    let from: String
    let to: String
    /// "2500 ft", "2500/3500 ft" (as published), or "none published".
    let altitude: String
    /// "Civil", "By request (ATC approval)", "Military (IAF approval)".
    let routeType: String
    /// "CLSD to 13:30Z" when a drawn closure covers the segment.
    let closure: String?
    /// Red for a full closure, amber for partial and "check NOTAM"; nil without a closure.
    var closureSeverity: IsraelClosureSeverity? = nil
    /// Exceptions as written, or the unread clause, shown under the closure line.
    var closureNotes: [String] = []
}

nonisolated struct IsraelPointDetail: Equatable, Sendable, Identifiable {
    let id: Int
    let code: String
    let nameEnglish: String?
    let nameHebrew: String?
    /// "Compulsory reporting point", "On-request reporting point", "Aerodrome reference point".
    let kindText: String
    let rows: [IsraelRouteAltitudeRow]
}

nonisolated struct IsraelAirspaceDetail: Equatable, Sendable, Identifiable {
    let id: Int
    let title: String
    let nameEnglish: String?
    let nameHebrew: String?
    /// "CTR (control zone)", "P (prohibited area)"...
    let typeText: String
    let floor: String
    let ceiling: String
    /// The chart label as published for TMAs ("LLBG TMA 2 500 - 8 000"); nil for other types.
    let rawText: String?
    let authority: String?
    /// Shown whenever a limit's reference was inferred rather than published.
    let referenceNote: String?
}

nonisolated enum IsraelChartSelection: Equatable, Sendable, Identifiable {
    case point(IsraelPointDetail)
    case airspaces([IsraelAirspaceDetail])
    /// An aerodrome symbol or ARP: opens IL-4's airport sheet for this code, not a chart sheet.
    case aerodrome(code: String)

    var id: String {
        switch self {
        case .point(let detail): return "point-\(detail.id)"
        case .airspaces(let details): return "airspaces-" + details.map { String($0.id) }.joined(separator: ",")
        case .aerodrome(let code): return "aerodrome-\(code)"
        }
    }
}

nonisolated enum IsraelChartDetails {

    static func kindText(_ kind: IsraelPointKind) -> String {
        switch kind {
        case .compulsory: return "Compulsory reporting point"
        case .onRequest: return "On-request reporting point"
        case .arp: return "Aerodrome reference point"
        case .unlisted: return "Sport-aviation route end (not a published point)"
        }
    }

    static func routeTypeText(_ segment: IsraelRouteSegment) -> String {
        if segment.isMilitary { return "Military (IAF approval)" }
        if segment.isByRequest { return "By request (ATC approval)" }
        return "Civil"
    }

    static func altitudeText(_ altitude: IsraelRouteAltitude?) -> String {
        guard let altitude else { return "none published" }
        return altitude.published + " ft"
    }

    /// The point, with every segment that starts or ends at it. Each direction is a row, so the pilot
    /// reads the altitude for the way he is flying.
    static func point(
        _ point: IsraelReportingPoint,
        segments: [IsraelRouteSegment],
        closures: [Int: IsraelChartClosureMark]
    ) -> IsraelPointDetail {
        let code = point.code.uppercased()
        var rows: [IsraelRouteAltitudeRow] = []
        for segment in segments where segment.fromCode.uppercased() == code || segment.toCode.uppercased() == code {
            let mark = closures[segment.id]
            let closure = mark?.text
            let type = routeTypeText(segment)
            rows.append(IsraelRouteAltitudeRow(
                segmentID: segment.id, from: segment.fromCode, to: segment.toCode,
                altitude: altitudeText(segment.altitudeForward), routeType: type, closure: closure,
                closureSeverity: mark?.severity, closureNotes: mark?.notes ?? []
            ))
            rows.append(IsraelRouteAltitudeRow(
                segmentID: segment.id, from: segment.toCode, to: segment.fromCode,
                altitude: altitudeText(segment.altitudeReverse), routeType: type, closure: closure,
                closureSeverity: mark?.severity, closureNotes: mark?.notes ?? []
            ))
        }
        // Leaving this point first, then arriving; stable by neighbour code.
        rows.sort {
            let lhsLeaving = $0.from.uppercased() == code, rhsLeaving = $1.from.uppercased() == code
            if lhsLeaving != rhsLeaving { return lhsLeaving }
            return ($0.to + $0.from, $0.segmentID) < ($1.to + $1.from, $1.segmentID)
        }
        return IsraelPointDetail(
            id: point.id, code: point.code, nameEnglish: point.nameEnglish, nameHebrew: point.nameHebrew,
            kindText: kindText(point.kind), rows: rows
        )
    }

    static func typeText(_ kind: IsraelAirspaceKind) -> String {
        switch kind {
        case .ctr: return "CTR (control zone)"
        case .atz: return "ATZ (aerodrome traffic zone)"
        case .cta: return "CTA (control area)"
        case .tma: return "TMA (terminal control area)"
        case .prohibited: return "P (prohibited area)"
        case .restricted: return "R (restricted area)"
        case .danger: return "D (danger area)"
        case .fir: return "FIR"
        }
    }

    /// "3000 ft MSL", "SFC", "FL95", "3000/3500 ft (as published)", "not published".
    static func limitDetail(_ limit: IsraelAirspaceLimit) -> String {
        if let text = limit.publishedText, !text.isEmpty { return text + " ft (as published)" }
        switch limit.reference {
        case .surface: return "SFC (ground)"
        case .unlimited: return "Unlimited"
        case .flightLevel: return limit.feet.map { "FL\($0 / 100)" } ?? "FL (value not published)"
        case .agl: return limit.feet.map { "\($0) ft AGL" } ?? "not published"
        case .msl: return limit.feet.map { "\($0) ft MSL" } ?? "not published"
        case nil: return limit.feet.map { "\($0) ft" } ?? "not published"
        }
    }

    /// IL-1 sets MSL for every non-zero limit because the CAAI layers carry no reference. Say so.
    static func referenceNote(floor: IsraelAirspaceLimit, ceiling: IsraelAirspaceLimit) -> String? {
        let inferred = [floor, ceiling].contains { $0.reference == .msl && $0.publishedText == nil }
        return inferred ? "Altitude reference (MSL) is inferred from the AIP; the CAAI data does not state it. Check the AIP." : nil
    }

    static func airspace(_ airspace: IsraelAirspace) -> IsraelAirspaceDetail {
        IsraelAirspaceDetail(
            id: airspace.id,
            title: IsraelChartFeatureBuilder.airspaceTitle(airspace),
            nameEnglish: airspace.nameEnglish, nameHebrew: airspace.nameHebrew,
            typeText: typeText(airspace.kind),
            floor: limitDetail(airspace.floor), ceiling: limitDetail(airspace.ceiling),
            rawText: airspace.label,
            authority: airspace.authority.map { $0 == .military ? "Military" : "Civil" },
            referenceNote: referenceNote(floor: airspace.floor, ceiling: airspace.ceiling)
        )
    }

    /// Prohibited, restricted and danger areas first, then the rest.
    static func airspaces(_ airspaces: [IsraelAirspace]) -> [IsraelAirspaceDetail] {
        airspaces
            .sorted {
                let l = IsraelChartFeatureBuilder.isRestricted($0.kind), r = IsraelChartFeatureBuilder.isRestricted($1.kind)
                return l != r ? l : $0.id < $1.id
            }
            .map(airspace)
    }
}
