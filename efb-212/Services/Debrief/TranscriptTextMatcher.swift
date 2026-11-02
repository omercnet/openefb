//
//  TranscriptTextMatcher.swift
//  efb-212
//
//  Finds Israel reporting points in transcript text, Hebrew or English. Matching is on normalised text:
//  niqqud and cantillation removed, final letters folded to their medial forms, punctuation (incl. maqaf)
//  turned into spaces, Latin letters lowercased. Pure and nonisolated.
//

import Foundation

nonisolated enum TranscriptTextMatcher {

    /// Hebrew final letters -> medial forms (ך ם ן ף ץ -> כ מ נ פ צ).
    private static let finalLetters: [Character: Character] = [
        "\u{05DA}": "\u{05DB}", "\u{05DD}": "\u{05DE}", "\u{05DF}": "\u{05E0}",
        "\u{05E3}": "\u{05E4}", "\u{05E5}": "\u{05E6}",
    ]

    /// Lowercased, niqqud-free, final-letter-folded text with every non-letter/digit run as one space.
    static func normalize(_ text: String) -> String {
        var out = ""
        var lastWasSpace = true
        for scalar in text.unicodeScalars {
            // Hebrew points and cantillation: U+0591...U+05C7 (U+05BE maqaf is punctuation, handled below).
            if (0x0591...0x05C7).contains(scalar.value) && scalar.value != 0x05BE { continue }
            let character = Character(scalar)
            if scalar.properties.isAlphabetic || scalar.properties.numericType != nil {
                let lowered = Character(String(character).lowercased())
                out.append(finalLetters[lowered] ?? lowered)
                lastWasSpace = false
            } else if !lastWasSpace {
                out.append(" ")
                lastWasSpace = true
            }
        }
        return out.trimmingCharacters(in: .whitespaces)
    }

    /// true when `text` names the point: its code, English name or Hebrew name, as whole words.
    /// Aerodrome ICAO codes ("LLHZ") count too.
    static func mentions(point: IsraelReportingPoint, in text: String) -> Bool {
        let haystack = " " + normalize(text) + " "
        var needles = [point.code]
        if let english = point.nameEnglish { needles.append(english) }
        if let hebrew = point.nameHebrew { needles.append(hebrew) }
        return needles.contains { needle in
            let normalized = normalize(needle)
            return !normalized.isEmpty && haystack.contains(" " + normalized + " ")
        }
    }

    /// Spoken forms to bias speech recognition towards: English and Hebrew names of the points.
    static func vocabulary(for points: [IsraelReportingPoint]) -> [String] {
        var seen = Set<String>()
        var terms: [String] = []
        for point in points where point.kind != .arp {
            for term in [point.nameEnglish, point.nameHebrew].compactMap({ $0 }) where seen.insert(term).inserted {
                terms.append(term)
            }
        }
        return terms
    }
}
