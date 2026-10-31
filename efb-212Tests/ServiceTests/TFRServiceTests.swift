//
//  TFRServiceTests.swift
//  efb-212Tests
//
//  Live FAA TFR parsing (WFS GeoJSON + XNOTAM detail XML), list/detail joining,
//  polygon geometry and polygon-based TFR proximity alerts.
//  Fixtures are real tfr.faa.gov responses captured 2026-10-30; the XNOTAM documents are
//  trimmed of construction geometry (<aseShapes>) and NOTAM text, all other values unchanged.
//

import Testing
import Foundation
import CoreLocation
import os
@testable import efb_212

@Suite("TFR Service Tests")
struct TFRServiceTests {

    // MARK: - Fixtures

    /// https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=TFR:V_TFR_LOC&outputFormat=application/json
    /// filtered to FDC 6/4348 (two areas) and FDC 9/2934.
    static let wfsJSON = Data(#"""
{"type":"FeatureCollection","totalFeatures":3,"numberMatched":3,"numberReturned":3,"timeStamp":"2026-10-30T19:15:04.044Z","crs":{"type":"name","properties":{"name":"urn:ogc:def:crs:EPSG::4269"}},"features":[{"type":"Feature","id":"V_TFR_LOC.6/4348","geometry":{"type":"Polygon","coordinates":[[[-97.64778425,47.96078719],[-97.64666252,47.94482119],[-97.64347526,47.92898153],[-97.63824857,47.91338857],[-97.63102395,47.89816071],[-97.62185793,47.88341348],[-97.61082161,47.86925866],[-97.59800006,47.85580345],[-97.58349164,47.84314969],[-97.56740725,47.83139305],[-97.54986945,47.82062239],[-97.53101153,47.81091904],[-97.51097651,47.80235625],[-97.48991605,47.7949986],[-97.46798935,47.78890159],[-97.44536194,47.78411116],[-97.42220446,47.78066341],[-97.39869144,47.77858432],[-97.375,47.77777778],[-97.375,48.14444444],[-97.39885894,48.14362715],[-97.42253436,48.14153358],[-97.44584422,48.13806218],[-97.46860937,48.13323966],[-97.49065496,48.12710308],[-97.51181185,48.1196996],[-97.53191792,48.1110861],[-97.55081935,48.1013287],[-97.5683718,48.0905023],[-97.58444154,48.07868993],[-97.59890644,48.06598212],[-97.61165693,48.0524762],[-97.62259682,48.03827555],[-97.63164394,48.02348876],[-97.63873084,48.00822881],[-97.64380515,47.9926122],[-97.64683001,47.97675805],[-97.64778425,47.96078719]]]},"geometry_name":"SHAPE","properties":{"GID":234374,"CNS_LOCATION_ID":"ZMP","NOTAM_KEY":"6/4348-1-FDC-F","TITLE":"GRAND FORKS AFB, ND, Sunday, March 8, 2026 through Sunday, November 1, 2026 Local","LAST_MODIFICATION_DATETIME":"202603051701","STATE":"ND","LEGAL":"SECURITY"}},{"type":"Feature","id":"V_TFR_LOC.6/4348","geometry":{"type":"Polygon","coordinates":[[[-97.45027778,47.90833333],[-97.39194444,47.90833333],[-97.39194444,48.01666667],[-97.45027778,48.01666667],[-97.45027778,47.90833333]]]},"geometry_name":"SHAPE","properties":{"GID":234373,"CNS_LOCATION_ID":"ZMP","NOTAM_KEY":"6/4348-1-FDC-F","TITLE":"GRAND FORKS AFB, ND, Sunday, March 8, 2026 through Sunday, November 1, 2026 Local","LAST_MODIFICATION_DATETIME":"202603051701","STATE":"ND","LEGAL":"SECURITY"}},{"type":"Feature","id":"V_TFR_LOC.9/2934","geometry":{"type":"Polygon","coordinates":[[[-96.82951491,32.8891651],[-96.82921358,32.88626534],[-96.82832007,32.88345377],[-96.82686159,32.88081581],[-96.82488247,32.8784316],[-96.82244289,32.87637356],[-96.81961696,32.8747042],[-96.81649053,32.87347421],[-96.81315855,32.87272095],[-96.80972222,32.87246729],[-96.80628589,32.87272095],[-96.80295391,32.87347421],[-96.79982748,32.8747042],[-96.79700155,32.87637356],[-96.79456197,32.8784316],[-96.79258285,32.88081581],[-96.79112437,32.88345377],[-96.79023086,32.88626534],[-96.78992953,32.8891651],[-96.79022959,32.89206496],[-96.79112198,32.8948768],[-96.79257964,32.89751517],[-96.79455831,32.89989988],[-96.79699789,32.90195846],[-96.79982427,32.90362832],[-96.80295153,32.90485873],[-96.80628462,32.90561226],[-96.80972222,32.905866],[-96.81315982,32.90561226],[-96.81649291,32.90485873],[-96.81962017,32.90362832],[-96.82244655,32.90195846],[-96.82488613,32.89989988],[-96.8268648,32.89751517],[-96.82832246,32.8948768],[-96.82921485,32.89206496],[-96.82951491,32.8891651]]]},"geometry_name":"SHAPE","properties":{"GID":231919,"CNS_LOCATION_ID":"ZFW","NOTAM_KEY":"9/2934-1-FDC-F","TITLE":"DALLAS, TX","LAST_MODIFICATION_DATETIME":"201510080555","STATE":"TX","LEGAL":"VIP"}}]}
"""#.utf8)

    /// https://tfr.faa.gov/download/detail_6_4348.xml (Grand Forks AFB, two areas).
    static let detail4348 = Data(#"""
<XNOTAM-Update xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="0.1" origin="" created="2026-10-04T03:43:38">
  <Group>
    <Add>
      <Not>
        <NotUid>
          <txtNameAcctFac>FDC</txtNameAcctFac>
          <dateIndexYear>2026</dateIndexYear>
          <noSeqNo>4348</noSeqNo>
          <dateIssued>2026-03-05T17:01:00</dateIssued>
          <txtLocalName>6/4348</txtLocalName>
          <codeGUID>295bb480-668b-4032-b16d-8dbea09e3334</codeGUID>
        </NotUid>
        <codeDailyOper>false</codeDailyOper>
        <dateEffective>2026-03-08T07:00:00</dateEffective>
        <dateExpire>2026-11-01T06:59:00</dateExpire>
        <codeTimeZone>CDT</codeTimeZone>
        <codeExpirationTimeZone>CDT</codeExpirationTimeZone>
        <AffLocGroup>
          <txtNameCity>GRAND FORKS AFB</txtNameCity>
          <txtNameUSState>NORTH DAKOTA</txtNameUSState>
        </AffLocGroup>
        <codeFacility>ZMP</codeFacility>
        <TfrNot>
          <codeType>99.7</codeType>
          <TFRAreaGroup>
            <aseTFRArea>
              <AseUid>
                <codeType>RAS</codeType>
                <codeId>364</codeId>
              </AseUid>
              <codeDistVerUpper>ALT</codeDistVerUpper>
              <valDistVerUpper>2400</valDistVerUpper>
              <uomDistVerUpper>FT</uomDistVerUpper>
              <codeDistVerLower>HEI</codeDistVerLower>
              <valDistVerLower>0</valDistVerLower>
              <uomDistVerLower>FT</uomDistVerLower>
              <codeExclVerUpper>INCLUDE</codeExclVerUpper>
              <codeExclVerLower>INCLUDE</codeExclVerLower>
              <isScheduledTfrArea>FALSE</isScheduledTfrArea>
              <ScheduleGroup>
                <isTimeSeparate>FALSE</isTimeSeparate>
                <dateEffective>2026-03-08T07:00:00</dateEffective>
                <dateExpire>2026-11-01T06:59:00</dateExpire>
              </ScheduleGroup>
            </aseTFRArea>
            <abdMergedArea>
              <AbdUid>
                <AseUid>
                  <codeType>RAS</codeType>
                  <codeId>364</codeId>
                </AseUid>
              </AbdUid>
              <txtRmk>364</txtRmk>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>48.01666667N</geoLat><geoLong>097.39194444W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>47.90833333N</geoLat><geoLong>097.39194444W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>47.90833333N</geoLat><geoLong>097.45027778W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>48.01666667N</geoLat><geoLong>097.45027778W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>48.01666667N</geoLat><geoLong>097.39194444W</geoLong></Avx>
            </abdMergedArea>
            <codeIncFRD>TRUE</codeIncFRD>
            <codeShpPrt>COMPOSITE</codeShpPrt>
            <codeLclTime>TRUE</codeLclTime>
            <codeAuthATC>FALSE</codeAuthATC>
          </TFRAreaGroup>
          <TFRAreaGroup>
            <aseTFRArea>
              <AseUid>
                <codeType>RAS</codeType>
                <codeId>366</codeId>
              </AseUid>
              <txtName>Area B</txtName>
              <codeDistVerUpper>ALT</codeDistVerUpper>
              <valDistVerUpper>180</valDistVerUpper>
              <uomDistVerUpper>FL</uomDistVerUpper>
              <codeDistVerLower>ALT</codeDistVerLower>
              <valDistVerLower>2400</valDistVerLower>
              <uomDistVerLower>FT</uomDistVerLower>
              <codeExclVerUpper>INCLUDE</codeExclVerUpper>
              <codeExclVerLower>INCLUDE</codeExclVerLower>
              <isScheduledTfrArea>FALSE</isScheduledTfrArea>
              <ScheduleGroup>
                <isTimeSeparate>FALSE</isTimeSeparate>
                <dateEffective>2026-03-08T07:00:00</dateEffective>
                <dateExpire>2026-11-01T06:59:00</dateExpire>
              </ScheduleGroup>
            </aseTFRArea>
            <abdMergedArea>
              <AbdUid>
                <AseUid>
                  <codeType>RAS</codeType>
                  <codeId>366</codeId>
                </AseUid>
              </AbdUid>
              <txtRmk>366</txtRmk>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>48.14444444N</geoLat><geoLong>097.375W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>47.77777778N</geoLat><geoLong>097.375W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>47.77858432N</geoLat><geoLong>097.39869144W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>47.78066341N</geoLat><geoLong>097.42220446W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>47.78411116N</geoLat><geoLong>097.44536194W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>47.78890159N</geoLat><geoLong>097.46798935W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>47.7949986N</geoLat><geoLong>097.48991605W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>47.80235625N</geoLat><geoLong>097.51097651W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>47.81091904N</geoLat><geoLong>097.53101153W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>47.82062239N</geoLat><geoLong>097.54986945W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>47.83139305N</geoLat><geoLong>097.56740725W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>47.84314969N</geoLat><geoLong>097.58349164W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>47.85580345N</geoLat><geoLong>097.59800006W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>47.86925866N</geoLat><geoLong>097.61082161W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>47.88341348N</geoLat><geoLong>097.62185793W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>47.89816071N</geoLat><geoLong>097.63102395W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>47.91338857N</geoLat><geoLong>097.63824857W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>47.92898153N</geoLat><geoLong>097.64347526W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>47.94482119N</geoLat><geoLong>097.64666252W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>47.96078719N</geoLat><geoLong>097.64778425W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>47.97675805N</geoLat><geoLong>097.64683001W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>47.9926122N</geoLat><geoLong>097.64380515W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>48.00822881N</geoLat><geoLong>097.63873084W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>48.02348876N</geoLat><geoLong>097.63164394W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>48.03827555N</geoLat><geoLong>097.62259682W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>48.0524762N</geoLat><geoLong>097.61165693W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>48.06598212N</geoLat><geoLong>097.59890644W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>48.07868993N</geoLat><geoLong>097.58444154W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>48.0905023N</geoLat><geoLong>097.5683718W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>48.1013287N</geoLat><geoLong>097.55081935W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>48.1110861N</geoLat><geoLong>097.53191792W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>48.1196996N</geoLat><geoLong>097.51181185W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>48.12710308N</geoLat><geoLong>097.49065496W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>48.13323966N</geoLat><geoLong>097.46860937W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>48.13806218N</geoLat><geoLong>097.44584422W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>48.14153358N</geoLat><geoLong>097.42253436W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>48.14362715N</geoLat><geoLong>097.39885894W</geoLong></Avx>
              <Avx><codeDatum>WGE</codeDatum><codeType>GRC</codeType><geoLat>48.14444444N</geoLat><geoLong>097.375W</geoLong></Avx>
            </abdMergedArea>
            <InstructionsGroup>
              <txtInstr>EXC AS SPECIFIED BLW AND/OR UNLESS AUTH BY ATC:</txtInstr>
              <txtInstr>1. ALL AIRCRAFT ENTERING OR EXITING THE TFR MUST BE ON A DISCRETE CODE ASSIGNED BY AN AIR TRAFFIC CONTROL (ATC) FACILITY, </txtInstr>
              <txtInstr>2. AIRCRAFT MUST BE SQUAWKING THE DISCRETE CODE AT ALL TIMES IN THE TFR. </txtInstr>
              <txtInstr>3. ALL AIRCRAFT ENTERING OR EXITING THE TFR MUST REMAIN IN TWO-WAY RADIO COMMUNICATIONS WITH ATC.</txtInstr>
              <txtInstr>4. MINNEAPOLIS CENTER, PHONE 651-463-5580, IS THE FAA COORDINATION FACILITY.</txtInstr>
            </InstructionsGroup>
            <codeIncFRD>TRUE</codeIncFRD>
            <codeShpPrt>COMPOSITE</codeShpPrt>
            <codeLclTime>TRUE</codeLclTime>
            <codeAuthATC>FALSE</codeAuthATC>
          </TFRAreaGroup>
          <TemplateType>BigThreatLanguage</TemplateType>
          <codeCtrlFacilityType>ARTCC</codeCtrlFacilityType>
        </TfrNot>
        <codeCoordFacilityType>ARTCC</codeCoordFacilityType>
        <codeFreeformText>false</codeFreeformText>
      </Not>
    </Add>
  </Group>
</XNOTAM-Update>
"""#.utf8)

    /// https://tfr.faa.gov/download/detail_9_2934.xml (no dateEffective/dateExpire: "EFFECTIVE IMMEDIATELY UNTIL FURTHER NOTICE").
    static let detail2934 = Data(#"""
<XNOTAM-Update xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="0.1" origin="" created="2026-08-14T06:07:57">
  <Group>
    <Add>
      <Not>
        <NotUid>
          <txtNameAcctFac>FDC</txtNameAcctFac>
          <dateIndexYear>2009</dateIndexYear>
          <noSeqNo>2934</noSeqNo>
          <dateIssued>2015-10-08T05:55:00</dateIssued>
          <txtLocalName>9/2934</txtLocalName>
          <codeGUID>3b8882ff-5794-4b7d-a4f5-e82875904b1b</codeGUID>
        </NotUid>
        <codeDailyOper>false</codeDailyOper>
        <codeTimeZone>UTC</codeTimeZone>
        <codeExpirationTimeZone>UTC</codeExpirationTimeZone>
        <AffLocGroup>
          <txtNameCity>DALLAS</txtNameCity>
          <txtNameUSState>TEXAS</txtNameUSState>
        </AffLocGroup>
        <codeFacility>ZFW</codeFacility>
        <TfrNot>
          <codeType>91.141</codeType>
          <TFRAreaGroup>
            <aseTFRArea>
              <AseUid>
                <codeType>RAS</codeType>
                <codeId>17366</codeId>
              </AseUid>
              <txtName> Area</txtName>
              <codeDistVerUpper>HEI</codeDistVerUpper>
              <valDistVerUpper>1500</valDistVerUpper>
              <uomDistVerUpper>FT</uomDistVerUpper>
              <codeDistVerLower>HEI</codeDistVerLower>
              <valDistVerLower>0</valDistVerLower>
              <uomDistVerLower>FT</uomDistVerLower>
              <codeExclVerUpper>INCLUDE</codeExclVerUpper>
              <codeExclVerLower>INCLUDE</codeExclVerLower>
              <isScheduledTfrArea>FALSE</isScheduledTfrArea>
            </aseTFRArea>
            <abdMergedArea>
              <AbdUid>
                <AseUid>
                  <codeType>RAS</codeType>
                  <codeId>17366</codeId>
                </AseUid>
              </AbdUid>
              <txtRmk>17366</txtRmk>
            </abdMergedArea>
            <codeIncFRD>TRUE</codeIncFRD>
            <codeShpPrt>COMPOSITE</codeShpPrt>
            <codeLclTime>TRUE</codeLclTime>
            <codeAuthATC>FALSE</codeAuthATC>
          </TFRAreaGroup>
          <TemplateType>BigThreatLanguage</TemplateType>
          <codeCtrlFacilityType>ARTCC</codeCtrlFacilityType>
        </TfrNot>
        <codeCoordFacilityType>ARTCC</codeCoordFacilityType>
        <codeFreeformText>false</codeFreeformText>
      </Not>
    </Add>
  </Group>
</XNOTAM-Update>
"""#.utf8)

    static func utc(_ string: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        return formatter.date(from: string)
    }

    static func joinedFixtureTFRs() throws -> [TFR] {
        let features = try TFRParser.parseFeatures(wfsJSON)
        let details = [
            "6/4348": try #require(TFRParser.parseDetail(detail4348)),
            "9/2934": try #require(TFRParser.parseDetail(detail2934))
        ]
        return TFRParser.join(features: features, details: details)
    }

    // MARK: - WFS GeoJSON

    @Test func parsesWFSFeaturesSwappingLonLatToLatLon() throws {
        let features = try TFRParser.parseFeatures(Self.wfsJSON)
        #expect(features.count == 3)

        let first = try #require(features.first)
        #expect(first.notamID == "6/4348")  // from NOTAM_KEY "6/4348-1-FDC-F"
        #expect(first.type == .security)
        #expect(first.state == "ND")
        #expect(first.facility == "ZMP")
        #expect(first.title.hasPrefix("GRAND FORKS AFB, ND"))
        // GeoJSON position [-97.64778425, 47.96078719] is [lon, lat]
        #expect(first.ring.first == [47.96078719, -97.64778425])
        #expect(first.ring.count == 38)
        #expect(first.ring.allSatisfy { $0[0] > 47 && $0[0] < 49 && $0[1] < -97 && $0[1] > -98 })

        #expect(features[2].notamID == "9/2934")
        #expect(features[2].type == .vip)
    }

    @Test func parsesLastModificationAsUTC() throws {
        let features = try TFRParser.parseFeatures(Self.wfsJSON)
        let first = try #require(features.first)
        #expect(first.lastModifiedRaw == "202603051701")  // yyyyMMddHHmm
        #expect(first.lastModified == Self.utc("2026-03-05T17:01:00Z"))
    }

    @Test func rejectsNonFeatureCollection() {
        #expect(throws: (any Error).self) {
            _ = try TFRParser.parseFeatures(Data(#"[{"notam_id":"6/4085"}]"#.utf8))
        }
    }

    @Test func mapsFAACategoriesToTFRType() {
        #expect(TFRType(faaType: "SECURITY") == .security)
        #expect(TFRType(faaType: "HAZARDS") == .hazard)
        #expect(TFRType(faaType: "AIR SHOWS/SPORTS") == .airShowSports)
        #expect(TFRType(faaType: "SPACE OPERATIONS") == .spaceOperations)
        #expect(TFRType(faaType: "UAS PUBLIC GATHERING") == .uasPublicGathering)
        #expect(TFRType(faaType: "vip ") == .vip)
        #expect(TFRType(faaType: "SOMETHING NEW") == .other)
    }

    // MARK: - XNOTAM Detail

    @Test func parsesDetailDatesAsUTCAndAreaLimits() throws {
        let detail = try #require(TFRParser.parseDetail(Self.detail4348))
        #expect(detail.notamID == "6/4348")
        // XML says codeTimeZone CDT but the NOTAM text confirms these are UTC
        #expect(detail.effectiveDate == Self.utc("2026-03-08T07:00:00Z"))
        #expect(detail.expirationDate == Self.utc("2026-11-01T06:59:00Z"))
        #expect(detail.areas.count == 2)

        let areaA = try #require(detail.areas.first { $0.id == "364" })
        #expect(areaA.floor == TFRAltitude(value: 0, reference: .agl))
        #expect(areaA.ceiling == TFRAltitude(value: 2400, reference: .msl))
        #expect(areaA.ring.count == 5)       // only <abdMergedArea> vertices, not <aseShapes>
        #expect(areaA.ring.first == [48.01666667, -97.39194444])  // "48.01666667N" / "97.39194444W"

        let areaB = try #require(detail.areas.first { $0.id == "366" })
        #expect(areaB.name == "Area B")
        #expect(areaB.floor == TFRAltitude(value: 2400, reference: .msl))
        #expect(areaB.ceiling == TFRAltitude(value: 180, reference: .flightLevel))
        #expect(areaB.ring.count == 38)
    }

    @Test func missingDetailDatesMeanOpenEnded() throws {
        let detail = try #require(TFRParser.parseDetail(Self.detail2934))
        #expect(detail.effectiveDate == nil)
        #expect(detail.expirationDate == nil)
        #expect(detail.areas.count == 1)
        #expect(detail.areas.first?.ceiling == TFRAltitude(value: 1500, reference: .agl))
    }

    @Test func malformedDetailReturnsNil() {
        #expect(TFRParser.parseDetail(Data("<html><body>404".utf8)) == nil)
    }

    @Test func altitudeCodesMapToReferences() {
        #expect(TFRParser.altitude(code: "ALT", value: "17999", unit: "FT") == TFRAltitude(value: 17999, reference: .msl))
        #expect(TFRParser.altitude(code: "HEI", value: "3000", unit: "FT") == TFRAltitude(value: 3000, reference: .agl))
        #expect(TFRParser.altitude(code: "ALT", value: "430", unit: "FL") == TFRAltitude(value: 430, reference: .flightLevel))
        #expect(TFRParser.altitude(code: nil, value: "100", unit: "FT") == nil)
        #expect(TFRParser.altitude(code: "ALT", value: nil, unit: "FT") == nil)
        #expect(TFRAltitude(value: 180, reference: .flightLevel).feet == 18000)
    }

    // MARK: - Join

    @Test func joinMatchesEachPolygonToItsOwnArea() throws {
        let tfrs = try Self.joinedFixtureTFRs()
        #expect(tfrs.map(\.id) == ["6/4348#0", "6/4348#1", "9/2934#0"])

        // WFS polygon 0 (38 vertices) is Area B; polygon 1 (5 vertices) is the unnamed surface area
        #expect(tfrs[0].floor == TFRAltitude(value: 2400, reference: .msl))
        #expect(tfrs[0].ceiling == TFRAltitude(value: 180, reference: .flightLevel))
        #expect(tfrs[0].altitudeDescription == "2400' MSL-FL180")
        #expect(tfrs[1].altitudeDescription == "SFC-2400' MSL")

        #expect(tfrs[0].effectiveDate == Self.utc("2026-03-08T07:00:00Z"))
        #expect(tfrs[1].expirationDate == Self.utc("2026-11-01T06:59:00Z"))
        #expect(tfrs[2].altitudeDescription == "SFC-1500' AGL")
        #expect(tfrs[2].effectiveDate == nil && tfrs[2].expirationDate == nil)
    }

    @Test func joinWithoutDetailLeavesAltitudesAndTimesUnknown() throws {
        let features = try TFRParser.parseFeatures(Self.wfsJSON)
        let tfrs = TFRParser.join(features: features, details: [:])
        #expect(tfrs.count == 3)
        #expect(tfrs.allSatisfy { $0.floor == nil && $0.ceiling == nil })
        #expect(tfrs.allSatisfy { $0.altitudeDescription == "See NOTAM" })
        #expect(tfrs.allSatisfy { $0.effectiveDate == nil && $0.expirationDate == nil })
    }

    @Test func indistinguishableAreasWithDifferentLimitsAreNotGuessed() {
        // Same footprint published twice with different limits (as in FDC 6/3002 Areas C and E)
        let ring: [[Double]] = [[64.0, -149.0], [64.0, -148.0], [65.0, -148.0], [65.0, -149.0], [64.0, -149.0]]
        let areaC = TFRDetail.Area(id: "C", name: "C", floor: TFRAltitude(value: 2600, reference: .agl),
                                   ceiling: TFRAltitude(value: 430, reference: .flightLevel), ring: ring)
        let areaE = TFRDetail.Area(id: "E", name: "E", floor: TFRAltitude(value: 1000, reference: .agl),
                                   ceiling: TFRAltitude(value: 2600, reference: .agl), ring: ring)
        #expect(TFRParser.matchArea(for: ring, in: [areaC, areaE]) == nil)

        let sameLimits = TFRDetail.Area(id: "C2", name: "Copy", floor: areaC.floor, ceiling: areaC.ceiling, ring: ring)
        #expect(TFRParser.matchArea(for: ring, in: [areaC, sameLimits])?.ceiling == areaC.ceiling)
    }

    // MARK: - Activity

    @Test func activityFollowsDetailDates() throws {
        let tfrs = try Self.joinedFixtureTFRs()
        let during = try #require(Self.utc("2026-10-30T12:00:00Z"))
        let after = try #require(Self.utc("2026-11-01T07:00:00Z"))
        let before = try #require(Self.utc("2026-03-08T06:59:00Z"))
        #expect(tfrs[1].isActive(at: during))
        #expect(!tfrs[1].isActive(at: after))
        #expect(!tfrs[1].isActive(at: before))
        // Until further notice: always active
        #expect(tfrs[2].isActive(at: after))
    }

    // MARK: - Polygon Geometry

    @Test func pointInPolygon() {
        let square: [[Double]] = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]
        #expect(PolygonGeometry.contains(CLLocationCoordinate2D(latitude: 0.5, longitude: 0.5), ring: square))
        #expect(!PolygonGeometry.contains(CLLocationCoordinate2D(latitude: -0.05, longitude: 0.5), ring: square))
        #expect(!PolygonGeometry.contains(CLLocationCoordinate2D(latitude: 0.5, longitude: 1.2), ring: square))
        // Concave "L": the notch is outside
        let ell: [[Double]] = [[0, 0], [0, 2], [1, 2], [1, 1], [2, 1], [2, 0]]
        #expect(PolygonGeometry.contains(CLLocationCoordinate2D(latitude: 1.5, longitude: 0.5), ring: ell))
        #expect(!PolygonGeometry.contains(CLLocationCoordinate2D(latitude: 1.5, longitude: 1.5), ring: ell))
    }

    @Test func distanceToEdgeInNauticalMiles() throws {
        let square: [[Double]] = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]
        // 0.05 deg south of the bottom edge at the equator = 3.0 NM
        let south = try #require(PolygonGeometry.distanceToEdgeNM(
            from: CLLocationCoordinate2D(latitude: -0.05, longitude: 0.5), ring: square))
        #expect(abs(south - 3.0) < 0.001)
        // Beyond a corner: distance to the vertex, not to the infinite edge line
        let corner = try #require(PolygonGeometry.distanceToEdgeNM(
            from: CLLocationCoordinate2D(latitude: -0.03, longitude: -0.04), ring: square))
        #expect(abs(corner - 3.0) < 0.01)
        // Inside: distanceNM is 0, distanceToEdge is to the nearest side
        let center = CLLocationCoordinate2D(latitude: 0.5, longitude: 0.9)
        #expect(PolygonGeometry.distanceNM(from: center, ring: square) == 0)
        let toEdge = try #require(PolygonGeometry.distanceToEdgeNM(from: center, ring: square))
        #expect(abs(toEdge - 6.0) < 0.01)
        // Longitude degrees shrink with latitude: 0.05 deg west at 47.96N
        let fixtureArea: [[Double]] = [[47.90833333, -97.45027778], [47.90833333, -97.39194444],
                                       [48.01666667, -97.39194444], [48.01666667, -97.45027778]]
        let west = try #require(PolygonGeometry.distanceToEdgeNM(
            from: CLLocationCoordinate2D(latitude: 47.96, longitude: -97.50027778), ring: fixtureArea))
        #expect(abs(west - 0.05 * 60 * cos(47.96 * .pi / 180)) < 0.01)
    }

    // MARK: - Proximity Alerts

    @Test @MainActor func proximityAlertUsesPolygonBoundary() throws {
        let tfrs = try Self.joinedFixtureTFRs()
        let surfaceArea = try #require(tfrs.first { $0.id == "6/4348#1" })  // lat 47.908-48.017, lon -97.450 to -97.392
        let now = try #require(Self.utc("2026-10-30T12:00:00Z"))

        let inside = ProximityAlertService.tfrAlerts(
            for: CLLocationCoordinate2D(latitude: 47.96, longitude: -97.42), tfrs: [surfaceArea], now: now)
        #expect(inside.count == 1)
        #expect(inside.first?.distance == 0)
        #expect(inside.first?.altitude == "SFC-2400' MSL")
        #expect(inside.first?.type == .tfr)

        // 2 NM south of the southern edge (47.90833333 - 2/60)
        let near = ProximityAlertService.tfrAlerts(
            for: CLLocationCoordinate2D(latitude: 47.875, longitude: -97.42), tfrs: [surfaceArea], now: now)
        let nearDistance = try #require(near.first?.distance)
        #expect(abs(nearDistance - 2.0) < 0.01)

        // 6 NM south of the edge: beyond the 3 NM threshold
        let far = ProximityAlertService.tfrAlerts(
            for: CLLocationCoordinate2D(latitude: 47.80833333, longitude: -97.42), tfrs: [surfaceArea], now: now)
        #expect(far.isEmpty)
    }

    @Test @MainActor func proximityAlertIgnoresInactiveTFRs() throws {
        let tfrs = try Self.joinedFixtureTFRs()
        let surfaceArea = try #require(tfrs.first { $0.id == "6/4348#1" })
        let afterExpiry = try #require(Self.utc("2026-11-02T00:00:00Z"))
        let alerts = ProximityAlertService.tfrAlerts(
            for: CLLocationCoordinate2D(latitude: 47.96, longitude: -97.42), tfrs: [surfaceArea], now: afterExpiry)
        #expect(alerts.isEmpty)
    }

    @Test @MainActor func proximityAlertsSortedNearestFirst() throws {
        let tfrs = try Self.joinedFixtureTFRs()
        let now = try #require(Self.utc("2026-10-30T12:00:00Z"))
        // Inside Area B (which surrounds the surface area) and 2 NM south of the surface area;
        // FDC 9/2934 in Dallas is ~900 NM away
        let alerts = ProximityAlertService.tfrAlerts(
            for: CLLocationCoordinate2D(latitude: 47.875, longitude: -97.42), tfrs: tfrs, now: now)
        #expect(alerts.map(\.id) == ["tfr-6/4348#0", "tfr-6/4348#1"])
        #expect(alerts.first?.distance == 0)
        #expect(alerts.first?.altitude == "2400' MSL-FL180")
    }

    // MARK: - Service (network stubbed)

    /// Records requested paths; serves fixtures by URL.
    static func makeSession(
        log: OSAllocatedUnfairLock<[String]>,
        failing: OSAllocatedUnfairLock<Bool>
    ) -> URLSession {
        StubURLProtocol.session { request in
            let url = request.url?.absoluteString ?? ""
            log.withLock { $0.append(url) }
            if failing.withLock({ $0 }) { throw URLError(.notConnectedToInternet) }
            if url.contains("geoserver") { return (200, TFRServiceTests.wfsJSON) }
            if url.hasSuffix("detail_6_4348.xml") { return (200, TFRServiceTests.detail4348) }
            return (404, Data("<html>404</html>".utf8))  // 9/2934 detail unavailable
        }
    }

    @Test @MainActor func serviceJoinsLiveDataAndCachesForTenMinutes() async throws {
        let log = OSAllocatedUnfairLock<[String]>(initialState: [])
        let failing = OSAllocatedUnfairLock(initialState: false)
        let clock = OSAllocatedUnfairLock(initialState: Date(timeIntervalSince1970: 1_793_390_000))
        let service = TFRService(session: Self.makeSession(log: log, failing: failing), now: { clock.withLock { $0 } })

        let first = try await service.currentTFRs()
        #expect(first.fetchedAt == Date(timeIntervalSince1970: 1_793_390_000))
        #expect(first.tfrs.count == 3)
        #expect(first.tfrs[0].altitudeDescription == "2400' MSL-FL180")
        #expect(first.tfrs[2].altitudeDescription == "See NOTAM")  // detail 404
        #expect(log.withLock { $0.count } == 3)  // WFS + 2 details

        // 9 minutes later: served from cache, no requests
        clock.withLock { $0 = $0.addingTimeInterval(9 * 60) }
        let cached = try await service.currentTFRs()
        #expect(cached == first)
        #expect(log.withLock { $0.count } == 3)

        // 11 minutes after the fetch: WFS again; unchanged 6/4348 detail is reused, failed 9/2934 retried
        clock.withLock { $0 = $0.addingTimeInterval(2 * 60) }
        let refreshed = try await service.currentTFRs()
        #expect(refreshed.fetchedAt == first.fetchedAt.addingTimeInterval(11 * 60))
        let requests = log.withLock { $0 }
        #expect(requests.count == 5)
        #expect(requests.filter { $0.hasSuffix("detail_6_4348.xml") }.count == 1)
        #expect(requests.filter { $0.hasSuffix("detail_9_2934.xml") }.count == 2)
    }

    @Test @MainActor func serviceServesLastGoodSnapshotWhenOffline() async throws {
        let log = OSAllocatedUnfairLock<[String]>(initialState: [])
        let failing = OSAllocatedUnfairLock(initialState: false)
        let clock = OSAllocatedUnfairLock(initialState: Date(timeIntervalSince1970: 1_793_390_000))
        let service = TFRService(session: Self.makeSession(log: log, failing: failing), now: { clock.withLock { $0 } })

        let first = try await service.currentTFRs()
        failing.withLock { $0 = true }
        clock.withLock { $0 = $0.addingTimeInterval(30 * 60) }

        let stale = try await service.currentTFRs()
        #expect(stale == first)  // same fetchedAt, so the UI shows 30 min data age
    }

    @Test @MainActor func serviceThrowsWhenNothingWasEverFetched() async {
        let log = OSAllocatedUnfairLock<[String]>(initialState: [])
        let failing = OSAllocatedUnfairLock(initialState: true)
        let service = TFRService(session: Self.makeSession(log: log, failing: failing))
        await #expect(throws: (any Error).self) {
            _ = try await service.currentTFRs()
        }
    }
}
