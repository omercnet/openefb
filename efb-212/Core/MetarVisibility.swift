//
//  MetarVisibility.swift
//  efb-212
//
//  Visibility as the raw METAR reports it. ICAO METARs (Israel) give metres in four digits ("4000",
//  "9999" = 10 km or more) or CAVOK; the AWC `visib` field is statute miles capped at "6+", which cannot
//  say "10 km", so the metric display reads the raw report.
//

import Foundation

nonisolated enum MetarVisibility {

    /// Prevailing visibility in metres from a raw ICAO METAR; 9999 means 10 km or more; CAVOK reads as 9999.
    /// nil when the report has no metric visibility group (a US SM report, or no raw text).
    static func metres(fromRaw raw: String?) -> Int? {
        guard let raw else { return nil }
        let tokens = raw.split(whereSeparator: { $0 == " " || $0.isNewline }).map(String.init)
        if tokens.contains("CAVOK") { return 9999 }
        // Visibility follows the wind group ("31008KT", "VRB03KT", optionally "280V350" after it).
        guard let wind = tokens.firstIndex(where: { $0.hasSuffix("KT") || $0.hasSuffix("MPS") }) else { return nil }
        for token in tokens[(wind + 1)...] {
            if token.count == 4, token.allSatisfy(\.isNumber), let value = Int(token) { return value }
            if token.hasSuffix("SM") { return nil }
            // Clouds, temperature or pressure groups: past the visibility position.
            if token.hasPrefix("Q") || token.contains("/") { return nil }
        }
        return nil
    }

    /// "≥10 km" for 9999, otherwise metres: "4000 m", "800 m".
    static func format(metres: Int) -> String {
        metres >= 9999 ? "≥10 km" : "\(metres) m"
    }
}
