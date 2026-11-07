//
//  FlownEntryActionTests.swift
//  efb-212Tests
//
//  A recorded flight's Flown row offers Sign for an unsigned draft and a read-only Logbook
//  action once signed, so a signed entry linked to a flight stays reachable.
//

import Testing
import Foundation
@testable import efb_212

@Suite("Flown Entry Action Tests")
struct FlownEntryActionTests {

    private func entry(flightID: UUID?, confirmed: Bool) -> SchemaV1.LogbookEntry {
        let entry = SchemaV1.LogbookEntry()
        entry.flightID = flightID
        entry.isConfirmed = confirmed
        return entry
    }

    @Test func noEntryOffersNoAction() {
        #expect(FlownEntryAction.forEntry(nil) == nil)
    }

    @Test func unsignedDraftOffersSign() {
        #expect(FlownEntryAction.forEntry(entry(flightID: UUID(), confirmed: false)) == .sign)
    }

    @Test func signedEntryOffersReview() {
        #expect(FlownEntryAction.forEntry(entry(flightID: UUID(), confirmed: true)) == .review)
    }

    @Test func signedEntryStaysLinkedToItsFlight() {
        let flightID = UUID()
        let signed = entry(flightID: flightID, confirmed: true)
        let linked = FlownEntryAction.entriesByFlight([signed, entry(flightID: nil, confirmed: true)])
        #expect(linked.count == 1)
        #expect(linked[flightID] === signed)
    }

    @Test func draftWinsOverSignedEntryForSameFlight() {
        let flightID = UUID()
        let signed = entry(flightID: flightID, confirmed: true)
        let draft = entry(flightID: flightID, confirmed: false)
        #expect(FlownEntryAction.entriesByFlight([signed, draft])[flightID] === draft)
        #expect(FlownEntryAction.entriesByFlight([draft, signed])[flightID] === draft)
    }
}
