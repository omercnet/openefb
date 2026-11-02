//
//  InstrumentStripLayoutTests.swift
//  efb-212Tests
//
//  Which readouts the instrument strip shows per size class: iPad keeps all four, iPhone
//  (compact width) drops VS so GS, ALT and TRK keep their size; DTG and ETE follow the route.
//

import Testing
@testable import efb_212

struct InstrumentStripLayoutTests {

    @Test func regularWidthShowsAllFourWithoutRoute() {
        #expect(InstrumentStripLayout.fields(compact: false, routeActive: false) == [.gs, .alt, .vs, .trk])
    }

    @Test func regularWidthAddsDistanceAndTimeWithRoute() {
        #expect(InstrumentStripLayout.fields(compact: false, routeActive: true) == [.gs, .alt, .vs, .trk, .dtg, .ete])
    }

    @Test func compactWidthKeepsOnlyKeyFields() {
        #expect(InstrumentStripLayout.fields(compact: true, routeActive: false) == [.gs, .alt, .trk])
    }

    @Test func compactWidthKeepsRouteFields() {
        #expect(InstrumentStripLayout.fields(compact: true, routeActive: true) == [.gs, .alt, .trk, .dtg, .ete])
    }
}
