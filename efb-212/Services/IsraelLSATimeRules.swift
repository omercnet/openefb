//
//  IsraelLSATimeRules.swift
//  efb-212
//
//  When the sport-aviation (LSA) routes marked "Weekend" are in use. Pure and nonisolated.
//
//  Source: domestic AIP B-08 section 1 item ז. "Weekend days" are Fridays from 06:00, holiday eves from
//  14:00, and Saturdays and holidays all day, unless stated otherwise for a bubble. Notes 2 and 3 move the
//  Friday start to 14:00 or 12:00 for named bubbles and control areas. CAAI's route layer carries only
//  AllWeek / Weekend / special per route; it does not say which Friday start belongs to which route, and
//  it has no holiday calendar. So this evaluator proves only what the text proves:
//    - Saturday, and Friday from the latest published start (14:00): in use.
//    - Friday 06:00 to 14:00: the default says weekend, a bubble may say later: unconfirmed.
//    - Anything else: not in use.
//  The pilot supplies holidays with `IsraelDayOverride`.
//

import Foundation

/// A day the pilot declares to be a holiday or a holiday eve; the data has no calendar of Israeli holidays.
nonisolated enum IsraelDayOverride: Equatable, Sendable, CaseIterable {
    case none
    /// Counts as a Friday from 14:00 until the end of the day.
    case holidayEve
    /// Counts as a Saturday, all day.
    case holiday
}

nonisolated enum IsraelWeekendState: Equatable, Sendable {
    /// Weekend by every published rule.
    case inUse
    /// Weekend by the default rule, but the route may belong to a bubble whose weekend starts later.
    case startUnconfirmed
    /// Not a weekend by any published rule.
    case notInUse
}

nonisolated enum IsraelLSATimeRules {

    /// Hour of the day (local Israel time) the AIP default Friday weekend starts: 06:00.
    static let fridayDefaultStartHour = 6
    /// The latest Friday start any bubble publishes, 14:00; also when a holiday eve begins.
    static let fridayLatestStartHour = 14

    static let timeZone = TimeZone(identifier: "Asia/Jerusalem") ?? .gmt

    private static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar
    }

    /// Weekend state at `instant`, local Israel time.
    static func weekendState(at instant: Date, override: IsraelDayOverride = .none) -> IsraelWeekendState {
        if override == .holiday { return .inUse }
        let parts = calendar.dateComponents([.weekday, .hour], from: instant)
        let hour = parts.hour ?? 0
        if override == .holidayEve, hour >= fridayLatestStartHour { return .inUse }
        switch parts.weekday {
        case 7:  // Saturday (Gregorian calendar: 1 = Sunday)
            return .inUse
        case 6:  // Friday
            if hour >= fridayLatestStartHour { return .inUse }
            if hour >= fridayDefaultStartHour { return .startUnconfirmed }
            return .notInUse
        default:
            return .notInUse
        }
    }
}
