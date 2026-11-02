//
//  IsraelDiagramStore.swift
//  efb-212
//
//  UI-facing state of the CAAI aerodrome diagram pack (IL-13): what is installed, the latest servable
//  edition on the host, download progress. Download, verification and install are IL-9's
//  `ChartPackService` with product `il-diagrams`.
//

import Foundation
import Observation

@MainActor
@Observable
final class IsraelDiagramStore {
    static let shared = IsraelDiagramStore()
    /// UserDefaults key: the edition that was published and validated when it was downloaded.
    nonisolated static let servedEditionKey = "israelDiagramsServedEdition"

    private(set) var pack: IsraelDiagramPack?
    /// Latest servable edition on the host; nil when none is published or the host was unreachable.
    private(set) var latest: IsraelChartManifest?
    private(set) var isChecking = false
    /// 0...1 while a download runs; nil when idle.
    private(set) var downloadProgress: Double?
    private(set) var errorMessage: String?

    @ObservationIgnored private let service: any ChartPackServiceProtocol
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var downloadTask: Task<Void, Never>?

    init(
        service: any ChartPackServiceProtocol = ChartPackService(product: IsraelDiagramPack.product, baseURL: IsraelChartConfig.baseURL),
        defaults: UserDefaults = .standard
    ) {
        self.service = service
        self.defaults = defaults
        reload()
    }

    var isDownloading: Bool { downloadProgress != nil }

    func availability(for icao: String) -> IsraelDiagramAvailability {
        pack?.availability(for: icao) ?? .none
    }

    /// Re-read what is on the device.
    func reload() {
        pack = IsraelDiagramPack.load(
            service: service, servedEdition: defaults.string(forKey: Self.servedEditionKey),
            allowUnpublished: IsraelChartConfig.allowUnpublished)
    }

    /// Ask the host for the latest servable edition. The installed pack keeps working when it fails.
    /// The installed pack is re-hashed once per launch; a pack that fails is removed and the pilot is told.
    func refresh() async {
        isChecking = true
        defer { isChecking = false }
        if !verified, pack != nil {
            verified = true
            if await service.verifyInstalled() == false {
                reload()
                errorMessage = EFBError.chartCorrupted(ChartPackService.regionName(service.product)).errorDescription
            }
        }
        latest = try? await service.latestServable(allowUnpublished: IsraelChartConfig.allowUnpublished)
    }

    @ObservationIgnored private var verified = false

    /// True when the host has a servable edition that is not the installed one.
    var canDownload: Bool {
        guard let latest else { return false }
        return pack?.edition != latest.edition
    }

    func startDownload() {
        guard downloadTask == nil, let manifest = latest else { return }
        errorMessage = nil
        downloadProgress = 0
        let reportProgress: @Sendable (Double) -> Void = { [weak self] fraction in
            Task { @MainActor in self?.noteProgress(fraction) }
        }
        downloadTask = Task { [service, defaults] in
            do {
                let installed = try await service.download(manifest, progress: reportProgress)
                if manifest.isServable(allowUnpublished: false) {
                    defaults.set(installed.edition, forKey: Self.servedEditionKey)
                }
                reload()
            } catch is CancellationError {
            } catch {
                errorMessage = error.localizedDescription
            }
            downloadProgress = nil
            downloadTask = nil
        }
    }

    fileprivate func noteProgress(_ fraction: Double) {
        if downloadProgress != nil { downloadProgress = fraction }
    }
}
