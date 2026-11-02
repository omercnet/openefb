//
//  DataRefreshScheduler.swift
//  efb-212
//
//  When to re-fetch the in-flight data layers (efb-zfm.13). Pure and `nonisolated`; the map view model
//  asks it which products are due and reports each attempt back.
//
//  - Each product refreshes once its data is as old as the service's own cache (METAR 15 min, TFR and
//    AIRMET/SIGMET 10 min), so a refresh is never answered from that cache.
//  - Low Power Mode doubles every interval (battery).
//  - No refresh without a network path, and only for layers the pilot has switched on.
//  - A failed attempt backs off: the next try waits 2x, then 4x (capped) the interval, and a success resets it.
//

import Foundation

nonisolated enum RefreshProduct: String, CaseIterable, Sendable {
    case weather
    case tfr
    case advisories

    /// Seconds between refreshes (data age at which the next fetch is due).
    var baseInterval: TimeInterval {
        switch self {
        case .weather: return 15 * 60      // WeatherService cache life
        case .tfr: return 10 * 60          // TFRService.refreshInterval
        case .advisories: return 10 * 60   // AirSigmetService.refreshInterval
        }
    }
}

nonisolated struct DataRefreshScheduler: Sendable {
    /// Longest backoff multiplier after repeated failures.
    static let maxBackoff = 4
    private(set) var lastAttempt: [RefreshProduct: Date] = [:]
    private(set) var failures: [RefreshProduct: Int] = [:]

    func interval(for product: RefreshProduct, lowPower: Bool) -> TimeInterval {
        let backoff = min(1 << min(failures[product] ?? 0, 2), Self.maxBackoff)
        return product.baseInterval * (lowPower ? 2 : 1) * Double(backoff)
    }

    /// - Parameter lastData: When the displayed data was fetched; nil if never.
    func isDue(_ product: RefreshProduct, lastData: Date?, now: Date, lowPower: Bool) -> Bool {
        let reference = max(lastData ?? .distantPast, lastAttempt[product] ?? .distantPast)
        return now.timeIntervalSince(reference) >= interval(for: product, lowPower: lowPower)
    }

    /// The products to refresh now: wanted (layer on), network available, and due.
    func due(wanted: Set<RefreshProduct>, lastData: [RefreshProduct: Date], now: Date,
             lowPower: Bool, networkAvailable: Bool) -> [RefreshProduct] {
        guard networkAvailable else { return [] }
        return RefreshProduct.allCases.filter {
            wanted.contains($0) && isDue($0, lastData: lastData[$0], now: now, lowPower: lowPower)
        }
    }

    mutating func recordAttempt(_ product: RefreshProduct, at now: Date, success: Bool) {
        lastAttempt[product] = now
        failures[product] = success ? 0 : (failures[product] ?? 0) + 1
    }
}
