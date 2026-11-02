//
//  IsraelRouteFollowingBar.swift
//  efb-212
//
//  The in-flight bar for an active Israel CVFR route (IL-ALERTS, efb-aac.8): the active leg, the altitude
//  published for the direction flown, the next reporting point with distance and ETA, and the leg after it.
//  Amber chips for the off-route and altitude cautions. Controls are 60 pt (the in-flight minimum),
//  nothing animates.
//

import SwiftUI

struct IsraelRouteFollowingBar: View {
    let route: ActiveRoute
    /// Nautical miles to the next point; nil until the first fix.
    let distanceToNext: Double?
    /// Rest of the route to the destination: nautical miles and seconds; nil while unknown.
    var remainingNM: Double?
    var remainingETE: TimeInterval?
    let onPrevious: () -> Void
    let onNext: () -> Void
    let onClear: () -> Void

    var body: some View {
        if let leg = route.current {
            VStack(alignment: .leading, spacing: Space.s) {
                HStack(spacing: Space.m) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(leg.fromCode) \u{2192} \(leg.toCode)")
                            .font(.system(.title3, design: .monospaced).weight(.bold))
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                            .accessibilityIdentifier("israel-route-leg")
                        Text(nextPointLine(for: leg))
                            .font(.system(.subheadline, design: .monospaced))
                            .foregroundStyle(Palette.secondaryText)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                            .accessibilityIdentifier("israel-route-next-point")
                    }
                    Spacer(minLength: Space.s)
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(leg.altitudeText)
                            .font(.system(.title2, design: .monospaced).weight(.bold))
                            .accessibilityIdentifier("israel-route-altitude")
                        Text("FT MSL")
                            .font(.caption2)
                            .foregroundStyle(Palette.secondaryText)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Published altitude \(leg.altitudeText) feet")
                }

                HStack {
                    if let following = followingLine {
                        Text(following)
                            .accessibilityIdentifier("israel-route-following-leg")
                    }
                    Spacer(minLength: Space.s)
                    if let totals = totalsLine {
                        Text(totals)
                            .accessibilityIdentifier("israel-route-remaining")
                    }
                }
                .font(.system(.subheadline, design: .monospaced))
                .foregroundStyle(Palette.secondaryText)
                .lineLimit(1)
                .minimumScaleFactor(0.7)

                cautionChips

                HStack(spacing: Space.s) {
                    controlButton("Prev", identifier: "israel-route-previous", enabled: route.currentLeg > 0, action: onPrevious)
                    controlButton("Next", identifier: "israel-route-next", enabled: !route.isLastLeg, action: onNext)
                    Spacer(minLength: 0)
                    controlButton("Clear", identifier: "clear-direct-to", enabled: true, action: onClear)
                }
            }
            .padding(Space.m)
            .background(.regularMaterial)
            .clipShape(RoundedRectangle(cornerRadius: MapControlMetrics.cornerRadius))
            .frame(maxWidth: 520)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("active-navigation-bar")
        }
    }

    // MARK: - Pieces

    @ViewBuilder
    private var cautionChips: some View {
        let following = route.following
        if following.isOffRoute || following.isAltitudeCaution {
            HStack(spacing: Space.s) {
                if following.isOffRoute, let text = Self.offRouteText(following) {
                    chip(text, identifier: "israel-route-off-route")
                }
                if following.isAltitudeCaution, let leg = route.current, let text = Self.altitudeText(following, published: leg.altitudeText) {
                    chip(text, identifier: "israel-route-altitude-caution")
                }
            }
        }
    }

    /// Amber caution: black on amber, 9:1 (white on amber is 2.2:1).
    private func chip(_ text: String, identifier: String) -> some View {
        Text(text)
            .font(.system(.headline, design: .monospaced).weight(.bold))
            .foregroundStyle(.black)
            .padding(.horizontal, Space.m)
            .padding(.vertical, Space.s)
            .background(Color.orange, in: RoundedRectangle(cornerRadius: 8))
            .accessibilityIdentifier(identifier)
    }

    private func controlButton(_ title: String, identifier: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.headline)
                .padding(.horizontal, Space.l)
                .frame(minWidth: MapControlMetrics.size, minHeight: MapControlMetrics.size)  // 60 pt target
                .background(Palette.fill, in: RoundedRectangle(cornerRadius: 8))
                .contentShape(Rectangle())
        }
        .buttonStyle(PressableButtonStyle())
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
        .accessibilityIdentifier(identifier)
    }

    // MARK: - Text (static so tests read the same strings)

    private func nextPointLine(for leg: ActiveRouteLeg) -> String {
        var parts = ["NEXT \(leg.toCode)"]
        if let distanceToNext { parts.append(String(format: "%.1f NM", distanceToNext)) }
        if let eta = route.following.nextPointETA { parts.append("ETA \(Self.etaText(eta))") }
        return parts.joined(separator: " \u{00B7} ")
    }

    private var followingLine: String? {
        guard let next = route.next else { return nil }
        return "THEN \(next.toCode) \u{00B7} \(next.altitudeText) FT"
    }

    /// "LLHA 46.9 NM \u{00B7} 0:28": the rest of the route, as the plan summary card used to show it.
    private var totalsLine: String? {
        guard let remainingNM, let code = route.destinationCode else { return nil }
        var text = "\(code) " + String(format: "%.1f NM", remainingNM)
        if let remainingETE {
            let minutes = Int((remainingETE / 60).rounded())
            text += String(format: " \u{00B7} %d:%02d", minutes / 60, minutes % 60)
        }
        return text
    }

    /// Local time in Israel, "03:36" (24 h, two digits: glanceable and unambiguous).
    static func etaText(_ date: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Jerusalem") ?? .current
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }

    /// "0.8 NM RIGHT OF ROUTE"; nil without a measurement.
    static func offRouteText(_ following: ActiveRouteFollowing) -> String? {
        guard let distance = following.crossTrackNM, let side = following.side else { return nil }
        return String(format: "%.1f NM %@ OF ROUTE", distance, side == .left ? "LEFT" : "RIGHT")
    }

    /// "350 FT HIGH \u{00B7} FLY 2500".
    static func altitudeText(_ following: ActiveRouteFollowing, published: String) -> String? {
        guard let deviation = following.altitudeDeviationFeet else { return nil }
        let feet = Int(abs(deviation).rounded())
        return "\(feet) FT \(deviation > 0 ? "HIGH" : "LOW") \u{00B7} FLY \(published)"
    }
}
