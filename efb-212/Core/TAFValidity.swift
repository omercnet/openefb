//
//  TAFValidity.swift
//  efb-212
//
//  The end of a TAF's valid period, read from the raw text so the TAF can read EXPIRED honestly
//  (efb-8d4). A TAF header looks like "TAF KPAO 021720Z 0218/0324 ..."; "0218/0324" is
//  day/hour (UTC) of the start and end of validity, 24 as the hour means midnight at the end of that day.
//  Pure and `nonisolated`.
//

import Foundation

nonisolated enum TAFValidity {
    /// The end of the valid period, or nil when the TAF has no parsable "DDHH/DDHH" group.
    /// The day of month is resolved to the calendar month that puts the end closest to `now`.
    static func validUntil(rawTAF: String, now: Date = Date()) -> Date? {
        guard let regex = try? NSRegularExpression(pattern: #"\b(\d{2})(\d{2})/(\d{2})(\d{2})\b"#),
              let match = regex.firstMatch(in: rawTAF, range: NSRange(rawTAF.startIndex..., in: rawTAF)),
              let dayRange = Range(match.range(at: 3), in: rawTAF), let hourRange = Range(match.range(at: 4), in: rawTAF),
              let endDay = Int(rawTAF[dayRange]), let endHour = Int(rawTAF[hourRange]),
              (1...31).contains(endDay), (0...24).contains(endHour) else { return nil }

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? TimeZone(secondsFromGMT: 0) ?? .current
        let reference = calendar.dateComponents([.year, .month], from: now)
        var best: Date?
        for monthOffset in -1...1 {
            guard let monthStart = calendar.date(from: reference).flatMap({ calendar.date(byAdding: .month, value: monthOffset, to: $0) }),
                  let range = calendar.range(of: .day, in: .month, for: monthStart), range.contains(endDay),
                  let day = calendar.date(byAdding: .day, value: endDay - 1, to: monthStart),
                  let candidate = calendar.date(byAdding: .hour, value: endHour, to: day) else { continue }
            if best == nil || abs(candidate.timeIntervalSince(now)) < abs(best?.timeIntervalSince(now) ?? .infinity) {
                best = candidate
            }
        }
        return best
    }
}
