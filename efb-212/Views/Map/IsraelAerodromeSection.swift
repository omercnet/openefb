//
//  IsraelAerodromeSection.swift
//  efb-212
//
//  Airport sheet content for an Israeli aerodrome (IL-4): the review note, use and PPR, hours, circuit,
//  runways in metres (the AIP's unit) with feet beside them, remarks and where each group of values came
//  from. Replaces the US runway list; weather and frequencies still come from the shared sheet sections.
//

import SwiftUI

struct IsraelAerodromeSection: View {
    let aerodrome: IsraelAerodrome

    @Environment(\.dynamicTypeSize) private var typeSize

    /// Label above value at accessibility sizes, beside it otherwise.
    private var rowLayout: AnyLayout {
        typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: Space.xs))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: Space.m))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.xl) {
            if !aerodrome.isReviewed {
                unreviewedNote
            }
            operationsSection
            runwaysSection
            if let remarks = aerodrome.remarks {
                VStack(alignment: .leading, spacing: Space.s) {
                    SectionHeader("REMARKS")
                    Text(remarks)
                        .font(TypeRole.body)
                }
            }
            sourcesSection
        }
        .accessibilityIdentifier("israel-aerodrome-section")
    }

    // MARK: - Review note

    /// Amber caution: the values are from the AIP but no person has checked them yet.
    private var unreviewedNote: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Label {
                Text("Unreviewed data")
                    .font(TypeRole.label)
            } icon: {
                Image(systemName: "exclamationmark.triangle.fill")
            }
            Text("Taken from the AIP and not yet checked by a person against the current publication. Verify before flight.")
                .font(TypeRole.caption)
            if !aerodrome.uncertainGroups.isEmpty {
                Text("The curator is unsure about: \(aerodrome.uncertainGroups.map(Self.groupLabel).joined(separator: ", ")).")
                    .font(TypeRole.caption.weight(.semibold))
            }
        }
        .foregroundStyle(Palette.caution)
        .padding(Space.m)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.fill, in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("israel-unreviewed-note")
    }

    static func groupLabel(_ group: String) -> String {
        switch group {
        case "elevation_ft": return "elevation"
        case "identity": return "position"
        default: return group
        }
    }

    // MARK: - Operations

    private var operationsSection: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            SectionHeader("OPERATIONS")
            Text(aerodrome.nameHebrew)
                .font(TypeRole.body)
                .foregroundStyle(Palette.secondaryText)
            if let useNote = Self.useNote(aerodrome.use) {
                Text(useNote)
                    .font(TypeRole.label)
                    .foregroundStyle(Palette.caution)
            }
            row("PPR", value: pprText)
            if let hours = aerodrome.hours {
                row("Hours", value: hours)
            }
            if let altitude = aerodrome.circuitAltitudeFeet {
                row("Circuit", value: "\(altitude)' MSL" + (aerodrome.circuitDirection.map { ", \($0)" } ?? ""))   // feet MSL (QNH)
            }
        }
    }

    private var pprText: String {
        switch aerodrome.ppr {
        case .yes: return "Required" + (aerodrome.pprText.map { ". \($0)" } ?? "")
        case .no: return "Not required" + (aerodrome.pprText.map { ". \($0)" } ?? "")
        case .unknown: return aerodrome.pprText ?? "Not stated in the AIP"
        }
    }

    static func useNote(_ use: IsraelAerodromeUse) -> String? {
        switch use {
        case .civil: return nil
        case .military: return "Military field: emergency use only"
        case .uas: return "Unmanned-aircraft strip: no manned landings without CAAI approval"
        case .agricultural: return "Agricultural strip: coordinate with the operator"
        case .hospital: return "Hospital helipad: coordinate with the hospital"
        case .foreign: return "Outside Israel: shown for orientation only"
        }
    }

    // MARK: - Runways

    private var runwaysSection: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            SectionHeader("RUNWAYS")
            if aerodrome.runways.isEmpty {
                Text("No runway data published")
                    .font(TypeRole.caption)
                    .foregroundStyle(Palette.secondaryText)
            } else {
                ForEach(aerodrome.runways) { runway in
                    rowLayout {
                        Text(runway.designator == "?" ? "RWY ?" : runway.designator)
                            .font(TypeRole.value)
                            .frame(minWidth: 72, alignment: .leading)
                        Text(Self.dimensions(runway))
                            .font(TypeRole.valueSmall)
                        Text(Self.surfaceAndHeading(runway))
                            .font(TypeRole.body)
                            .foregroundStyle(Palette.secondaryText)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Runway \(runway.designator)")
                    .accessibilityValue(Self.spoken(runway))
                }
            }
        }
    }

    /// "903 x 18 m" (metres, as the AIP gives them) with the length in feet: "2963 ft".
    static func dimensions(_ runway: IsraelAerodromeRunway) -> String {
        "\(number(runway.lengthMetres)) x \(number(runway.widthMetres)) m  (\(runway.lengthFeet) ft)"
    }

    static func surfaceAndHeading(_ runway: IsraelAerodromeRunway) -> String {
        var parts = [runway.surface == "unknown" ? "surface not published" : runway.surface.capitalized]
        if let a = runway.headingA, let b = runway.headingB, let isTrue = runway.headingIsTrue {
            parts.append("\(number(a))/\(number(b))\u{00B0} \(isTrue ? "true" : "magnetic")")   // degrees
        }
        return parts.joined(separator: ", ")
    }

    private static func spoken(_ runway: IsraelAerodromeRunway) -> String {
        "\(number(runway.lengthMetres)) by \(number(runway.widthMetres)) metres, \(surfaceAndHeading(runway))"
    }

    private static func number(_ value: Double) -> String {
        value.rounded() == value ? String(Int(value)) : String(format: "%g", value)
    }

    // MARK: - Sources

    private var sourcesSection: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            SectionHeader("SOURCES")
            sourceLine("Position, elevation", aerodrome.sources.identity)
            sourceLine("Runways", aerodrome.sources.runways)
            sourceLine("Frequencies", aerodrome.sources.frequencies)
            sourceLine("Circuit", aerodrome.sources.circuit)
            sourceLine("Hours", aerodrome.sources.hours)
            sourceLine("Remarks, PPR", aerodrome.sources.remarks)
            Text(aerodrome.isReviewed ? "Reviewed against the AIP." : "Not yet reviewed against the AIP.")
                .font(TypeRole.caption)
                .foregroundStyle(aerodrome.isReviewed ? Palette.secondaryText : Palette.caution)
                .padding(.top, Space.xs)
        }
    }

    @ViewBuilder
    private func sourceLine(_ label: String, _ source: String?) -> some View {
        if let source {
            Text("\(label): \(source)")
                .font(TypeRole.caption)
                .foregroundStyle(Palette.secondaryText)
        }
    }

    // MARK: - Rows

    private func row(_ label: String, value: String) -> some View {
        rowLayout {
            Text(label)
                .font(TypeRole.label)
                .foregroundStyle(Palette.secondaryText)
                .frame(minWidth: 72, alignment: .leading)
            Text(value)
                .font(TypeRole.body)
                .foregroundStyle(Palette.primaryText)
        }
        .accessibilityElement(children: .combine)
    }
}
