//
//  WeatherViewModel.swift
//  efb-212
//
//  Weather data management for airport info sheet and weather displays.
//  Fetches METAR/TAF from WeatherService and provides decoded weather fields.
//  Per locked decision: auto-refresh on airport open + manual refresh button.
//

import Foundation
import Observation

@Observable
@MainActor
final class WeatherViewModel {

    // MARK: - Dependencies

    let weatherService: any WeatherServiceProtocol

    // MARK: - State

    var currentWeather: WeatherCache?
    var currentTAF: String?
    /// When `currentTAF` was fetched; with the TAF's own valid period it drives the TAF age badge.
    var tafFetchedAt: Date?
    /// The last TAF fetch failed (a previous TAF may still be shown, with its true age).
    var tafFailed: Bool = false
    var isLoading: Bool = false
    var error: EFBError?
    /// False when the region's station list says this aerodrome has no METAR (Israel: LLHZ has a TAF only).
    /// Then no request is made and the sheet says so; it is not a download error.
    private(set) var metarPublished: Bool = true
    /// False when the region's station list says this aerodrome has no TAF.
    private(set) var tafPublished: Bool = true

    /// Freshness of the TAF now: the valid period end from its text decides, else its fetch age.
    func tafFreshness(now: Date = Date()) -> DataFreshness? {
        guard let taf = currentTAF else { return nil }
        return DataFreshness.evaluate(.taf, observed: tafFetchedAt, validUntil: TAFValidity.validUntil(rawTAF: taf, now: now), now: now)
    }

    // MARK: - Private

    /// Track current station for manual refresh.
    private var currentStationID: String?

    // MARK: - Init

    init(weatherService: any WeatherServiceProtocol) {
        self.weatherService = weatherService
    }

    // MARK: - Load Weather

    /// Load METAR and TAF for a station. Called on airport info sheet appear.
    func loadWeather(for stationID: String) async {
        if currentStationID != stationID {
            // A different station: nothing from the previous one may be shown as this station's TAF.
            currentTAF = nil
            tafFetchedAt = nil
        }
        currentStationID = stationID
        // Israel publishes weather for a short station list only; asking AWC for any other aerodrome
        // returns an empty body, which used to surface as "data isn't in the correct format".
        let station = region.weatherStation(id: stationID)
        metarPublished = region == .israel ? (station?.hasMETAR ?? false) : true
        tafPublished = region == .israel ? (station?.hasTAF ?? false) : true
        isLoading = true
        error = nil
        tafFailed = false

        if metarPublished {
            do {
                currentWeather = try await weatherService.fetchMETAR(for: stationID)
            } catch let fetchError as EFBError {
                error = fetchError
                // Keep cached weather if available; `error` stays set so the sheet says the refresh failed.
                currentWeather = weatherService.cachedWeather(for: stationID)
            } catch {
                self.error = EFBError.weatherFetchFailed(underlying: error)
                currentWeather = weatherService.cachedWeather(for: stationID)
            }
        } else {
            currentWeather = nil
        }

        if tafPublished {
            do {
                currentTAF = try await weatherService.fetchTAF(for: stationID)
                tafFetchedAt = Date()
            } catch {
                // METAR is primary, so this is not an error banner. But the previous TAF (if any) stays with
                // its true age, and `tafFailed` lets the sheet say the refresh failed.
                tafFailed = true
            }
        } else {
            currentTAF = nil
            tafFetchedAt = nil
        }

        isLoading = false
    }

    /// Manual refresh. Bypasses 15-min cache by clearing cache first.
    /// Per locked decision: "Weather auto-refreshes with 15-minute METAR cache,
    /// auto-refresh when airport info is opened, plus manual refresh button."
    func refreshWeather() async {
        guard let stationID = currentStationID else { return }

        // Force re-fetch by clearing service cache for this station
        if let service = weatherService as? WeatherService {
            await service.clearCache(for: stationID)
        }

        await loadWeather(for: stationID)
    }

    // MARK: - Decoded Weather Fields

    /// Formatted wind string: "310/08 KT", "310/08 G15 KT", "VRB/02 KT" (AWC sends no direction for variable wind) or "Calm"
    var decodedWind: String {
        guard let wx = currentWeather, let spd = wx.windSpeed else { return "---" }
        if spd == 0 { return "Calm" }
        let direction = wx.windDirection.map { String(format: "%03d", $0) } ?? "VRB"
        if let gust = wx.windGust {
            return String(format: "%@/%02d G%d KT", direction, spd, gust)
        }
        return String(format: "%@/%02d KT", direction, spd)
    }

    /// Formatted ceiling: "2500' BKN" or "CLR"
    var decodedCeiling: String {
        guard let wx = currentWeather else { return "---" }
        if let ceil = wx.ceiling {
            return "\(ceil)' BKN"
        }
        return "CLR"
    }

    /// Formatted visibility. US: "10 SM" or ">10 SM". Israel: metres from the raw METAR, "4000 m" or "≥10 km".
    var decodedVisibility: String {
        guard let wx = currentWeather else { return "---" }
        if region == .israel {
            // The AWC `visib` value is statute miles capped at "6+"; only the raw METAR has the metres.
            guard let metres = MetarVisibility.metres(fromRaw: wx.rawMETAR) else { return "---" }
            return MetarVisibility.format(metres: metres)
        }
        guard let vis = wx.visibility else { return "---" }
        if vis.contains("+") || vis == "10" {
            return ">10 SM"
        }
        return "\(vis) SM"
    }

    /// Formatted temperature: "16°C"
    var decodedTemp: String {
        guard let wx = currentWeather, let temp = wx.temperature else { return "---" }
        return "\(Int(temp))°C"  // degrees Celsius
    }

    /// Formatted dewpoint: "9°C"
    var decodedDew: String {
        guard let wx = currentWeather, let dew = wx.dewpoint else { return "---" }
        return "\(Int(dew))°C"  // degrees Celsius
    }

    /// Region whose altimeter unit the decoded fields use (US inHg, Israel hPa).
    var region: Region = .us

    /// Formatted altimeter setting in the region's unit: "30.02 inHg" or "1017 hPa".
    var decodedAltimeter: String {
        guard let hPa = currentWeather?.altimeterHPa else { return "---" }
        return region.formattedAltimeter(hPa: hPa)
    }
}
