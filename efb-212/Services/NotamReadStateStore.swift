//
//  NotamReadStateStore.swift
//  efb-212
//
//  Which NOTAMs the pilot has already read (IL-BRIEF). A NOTAM counts as read by its id *and* its
//  created stamp, so a NOTAMR that replaces a read NOTAM (same series, new id and stamp) or a re-issue
//  with the same id shows as unread again. Keys live in UserDefaults; a few hundred strings at most.
//

import Foundation
import Observation

protocol NotamReadStateStoreProtocol: AnyObject {
    func isRead(_ notam: IsraelNotam) -> Bool
    func markRead(_ notam: IsraelNotam)
    func markUnread(_ notam: IsraelNotam)
    func markAllRead(_ notams: [IsraelNotam])
}

@MainActor
@Observable
final class NotamReadStateStore: NotamReadStateStoreProtocol {
    static let shared = NotamReadStateStore()
    nonisolated static let defaultsKey = "israelNotamReadKeys"

    /// Keys of read NOTAMs (`readKey`). Observed by the briefing list so unread dots update live.
    private(set) var readKeys: Set<String>
    @ObservationIgnored private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        readKeys = Set(defaults.stringArray(forKey: Self.defaultsKey) ?? [])
    }

    /// "C2269/26@2026-10-25T14:31:00Z"; a NOTAM without a created stamp is keyed by id alone.
    nonisolated static func readKey(for notam: IsraelNotam) -> String {
        guard let created = notam.created else { return notam.id }
        return "\(notam.id)@\(created.formatted(.iso8601))"
    }

    func isRead(_ notam: IsraelNotam) -> Bool { readKeys.contains(Self.readKey(for: notam)) }

    func markRead(_ notam: IsraelNotam) {
        guard readKeys.insert(Self.readKey(for: notam)).inserted else { return }
        persist()
    }

    func markUnread(_ notam: IsraelNotam) {
        guard readKeys.remove(Self.readKey(for: notam)) != nil else { return }
        persist()
    }

    func markAllRead(_ notams: [IsraelNotam]) {
        let before = readKeys.count
        readKeys.formUnion(notams.map(Self.readKey(for:)))
        if readKeys.count != before { persist() }
    }

    /// Drop keys of NOTAMs no longer in the feed, so the list never grows without bound.
    func prune(keeping notams: [IsraelNotam]) {
        let live = Set(notams.map(Self.readKey(for:)))
        let kept = readKeys.intersection(live)
        guard kept.count != readKeys.count else { return }
        readKeys = kept
        persist()
    }

    private func persist() {
        defaults.set(Array(readKeys).sorted(), forKey: Self.defaultsKey)
    }
}
