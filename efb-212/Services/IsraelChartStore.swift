//
//  IsraelChartStore.swift
//  efb-212
//
//  UI-facing state of the official CAAI CVFR chart pack (IL-9): what is installed, the latest servable
//  edition on the host, download progress and errors. One shared instance; the Offline Maps screen
//  drives it and the map observes `status` and `packURL`.
//

import Foundation
import Observation

@MainActor
@Observable
final class IsraelChartStore {
    static let shared = IsraelChartStore()

    private(set) var installed: ChartPackInstalled?
    /// Latest servable edition on the host; nil when none is published, or when the host was unreachable.
    private(set) var latest: IsraelChartManifest?
    private(set) var isChecking = false
    /// True when the last update check could not reach the host (the installed pack still works).
    private(set) var checkFailed = false
    /// 0...1 while a download runs; nil when idle.
    private(set) var downloadProgress: Double?
    /// Fraction reached when the pilot paused; the partial file is kept and Download resumes it.
    private(set) var pausedProgress: Double?
    private(set) var errorMessage: String?

    @ObservationIgnored private let service: any ChartPackServiceProtocol
    @ObservationIgnored private var downloadTask: Task<Void, Never>?

    init(service: any ChartPackServiceProtocol = ChartPackService(product: IsraelChartConfig.product,
                                                                 baseURL: IsraelChartConfig.baseURL)) {
        self.service = service
        self.installed = service.installed()
    }

    var status: IsraelChartStatus { IsraelChartStatus.resolve(installed: installed, latest: latest) }

    var isDownloading: Bool { downloadProgress != nil }

    /// MBTiles file the map reads; nil when nothing valid is installed.
    var packURL: URL? {
        guard let installed, let pack = installed.files.first(where: { $0.name.hasSuffix(".mbtiles") }) else { return nil }
        return service.fileURL(pack.name)
    }

    /// Size shown on the download row: the latest edition when there is one to fetch, else what is installed.
    var offeredBytes: Int? { latest?.totalBytes ?? installed?.totalBytes }

    /// Re-read the device state and ask the host for the latest servable edition.
    func refresh() async {
        installed = service.installed()
        isChecking = true
        defer { isChecking = false }
        do {
            latest = try await service.latestServable(allowUnpublished: IsraelChartConfig.allowUnpublished)
            checkFailed = false
        } catch {
            // Offline or host down: keep what is installed, say the check failed, never invent an edition.
            latest = nil
            checkFailed = true
        }
    }

    /// Download (or resume) the latest servable edition. Returns immediately; observe `downloadProgress`.
    func startDownload() {
        guard downloadTask == nil, let manifest = latest else { return }
        errorMessage = nil
        pausedProgress = nil
        downloadProgress = 0
        let reportProgress: @Sendable (Double) -> Void = { [weak self] fraction in
            Task { @MainActor in self?.noteProgress(fraction) }
        }
        downloadTask = Task { [service, weak self] in
            guard let self else { return }
            do {
                let record = try await service.download(manifest, progress: reportProgress)
                installed = record
            } catch is CancellationError {
                // Pause: the partial file stays and the next start resumes it.
                pausedProgress = downloadProgress
            } catch {
                errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
            downloadProgress = nil
            downloadTask = nil
        }
    }

    /// Stop the download; the partial file is kept so Resume continues from there.
    func pauseDownload() {
        downloadTask?.cancel()
    }

    func remove() {
        downloadTask?.cancel()
        service.remove()
        installed = nil
        pausedProgress = nil
    }

    fileprivate func noteProgress(_ fraction: Double) {
        guard downloadProgress != nil else { return }
        downloadProgress = fraction
    }
}
