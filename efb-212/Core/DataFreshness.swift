//
//  DataFreshness.swift
//  efb-212
//
//  One freshness rule set for every dated product the pilot sees (design finding F12).
//  Neutral while the data is inside its useful life, amber "OLD" / "EXPIRED" once past it
//  (an expired chart cycle is amber, per Palette.caution), and red only where using the data
//  would be unsafe (TFR layer data too old to trust for avoidance). Thresholds are documented
//  in docs/DESIGN.md. Pure, `nonisolated`: evaluated off the main actor by services and tests.
//

import Foundation

/// A dated product with its own useful life.
nonisolated enum DataProduct: String, CaseIterable, Sendable {
    case metar
    case taf
    case pirep
    case windsAloft
    case tfr
    case airmetSigmet
    case notam
    case chartCycle

    /// Age (seconds since observation / fetch) past which the product reads OLD. nil: window-only.
    var oldAfter: TimeInterval? {
        switch self {
        case .metar:        return 75 * 60       // hourly product; one missed cycle
        case .taf:          return 7 * 3600      // issued every 6 h
        case .pirep:        return 60 * 60       // conditions change within the hour
        case .tfr:          return 30 * 60       // TFRs appear with minutes' notice
        case .airmetSigmet: return 30 * 60
        case .notam:        return 60 * 60
        case .windsAloft, .chartCycle: return nil
        }
    }

    /// Age past which the product reads EXPIRED. nil: only `validUntil` expires it.
    var expiredAfter: TimeInterval? {
        switch self {
        case .metar:        return 3 * 3600
        case .taf:          return nil           // the valid period decides
        case .pirep:        return 2 * 3600      // PirepSection.maxAge
        case .tfr:          return 2 * 3600
        case .airmetSigmet: return 2 * 3600
        case .notam:        return 6 * 3600
        case .windsAloft, .chartCycle: return nil
        }
    }

    /// Whether EXPIRED means "unsafe to use" (red) rather than "no longer current" (amber).
    var expiryIsUnsafe: Bool {
        self == .tfr
    }

    /// Window-only products warn this long before `validUntil` (amber "EXPIRES 3d").
    var warnBeforeExpiry: TimeInterval? {
        self == .chartCycle ? 7 * 86_400 : nil
    }

    /// Spoken name for accessibility.
    var displayName: String {
        switch self {
        case .metar: return "METAR"
        case .taf: return "TAF"
        case .pirep: return "PIREP"
        case .windsAloft: return "Winds aloft"
        case .tfr: return "TFR data"
        case .airmetSigmet: return "AIRMET/SIGMET data"
        case .notam: return "NOTAM data"
        case .chartCycle: return "Chart cycle"
        }
    }
}

/// How current a product is, in order of concern.
nonisolated enum FreshnessLevel: Int, Comparable, Sendable {
    /// No timestamp available: shown neutral as "N/A", never as current.
    case unknown
    case fresh
    /// Past its useful life, still usable with care (amber).
    case old
    /// No longer describes anything current (amber).
    case expired
    /// Using it would be unsafe (red).
    case unsafe

    static func < (lhs: Self, rhs: Self) -> Bool { lhs.rawValue < rhs.rawValue }
}

/// Result of a freshness evaluation: the level plus the badge text.
nonisolated struct DataFreshness: Equatable, Sendable {
    let product: DataProduct
    let level: FreshnessLevel
    /// Badge text: "12 min", "OLD 1h 20m", "EXPIRED", "VALID", "EXPIRES 3d", "N/A".
    let text: String

    /// - Parameters:
    ///   - observed: observation / issue / fetch time (age-based products).
    ///   - validFrom: start of the for-use window (winds aloft) if any.
    ///   - validUntil: end of validity (TAF valid period, winds FOR USE end, chart cycle end).
    static func evaluate(
        _ product: DataProduct,
        observed: Date? = nil,
        validFrom: Date? = nil,
        validUntil: Date? = nil,
        now: Date = Date()
    ) -> DataFreshness {
        // 1. Hard validity end wins over any age rule.
        if let validUntil, now > validUntil {
            return DataFreshness(product: product,
                                 level: product.expiryIsUnsafe ? .unsafe : .expired,
                                 text: "EXPIRED")
        }
        // 2. Not yet in its for-use window.
        if let validFrom, now < validFrom {
            return DataFreshness(product: product, level: .fresh, text: "NOT YET VALID")
        }
        // 3. Age-based rules.
        if let observed {
            let age = max(0, now.timeIntervalSince(observed))
            if let limit = product.expiredAfter, age >= limit {
                return DataFreshness(product: product,
                                     level: product.expiryIsUnsafe ? .unsafe : .expired,
                                     text: "EXPIRED")
            }
            if let limit = product.oldAfter, age >= limit {
                return DataFreshness(product: product, level: .old, text: "OLD \(ageText(age))")
            }
            if product.oldAfter != nil {
                return DataFreshness(product: product, level: .fresh, text: ageText(age))
            }
        }
        // 4. Window-only products: approaching the end of validity.
        if let validUntil {
            if let warn = product.warnBeforeExpiry, validUntil.timeIntervalSince(now) <= warn {
                let days = Int((validUntil.timeIntervalSince(now) / 86_400).rounded(.up))
                return DataFreshness(product: product, level: .old, text: "EXPIRES \(days)d")
            }
            return DataFreshness(product: product, level: .fresh, text: "VALID")
        }
        return DataFreshness(product: product, level: .unknown, text: "N/A")
    }

    /// "<1 min", "15 min", "1h", "1h 30m".
    static func ageText(_ age: TimeInterval) -> String {
        let minutes = Int(age / 60)
        if minutes < 1 { return "<1 min" }
        if minutes < 60 { return "\(minutes) min" }
        let hours = minutes / 60
        let rest = minutes % 60
        return rest == 0 ? "\(hours)h" : "\(hours)h \(rest)m"
    }
}
