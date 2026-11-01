//
//  FlightCategoryDot.swift
//  efb-212
//
//  Color-coded circle indicating FAA flight category.
//  Per UI-SPEC: 12pt default circle, FAA standard colors.
//  VFR=green, MVFR=blue, IFR=red, LIFR=magenta.
//  Colour is never the only signal: VoiceOver reads the category, and `showsLabel`
//  draws the VFR/MVFR/IFR/LIFR text next to the dot.
//

import SwiftUI

struct FlightCategoryDot: View {

    let category: FlightCategory
    var size: CGFloat = 12
    /// Draws the category text next to the dot (in primary text colour, so it meets contrast).
    var showsLabel: Bool = false

    /// Day/night pairs: the night variants are lighter so the dot stays distinct on the dark map.
    var color: Color {
        switch category {
        case .vfr: return .green
        case .mvfr:
            return Color(UIColor { trait in
                trait.userInterfaceStyle == .dark
                    ? UIColor(red: 0.56, green: 0.71, blue: 0.88, alpha: 1)
                    : .systemBlue
            })
        case .ifr: return .red
        case .lifr:
            return Color(UIColor { trait in
                trait.userInterfaceStyle == .dark
                    ? UIColor(red: 0.90, green: 0.45, blue: 0.90, alpha: 1)
                    : UIColor(red: 0.80, green: 0.00, blue: 0.80, alpha: 1)
            })
        }
    }

    /// Short category text: VFR, MVFR, IFR, LIFR.
    var label: String {
        category.rawValue.uppercased()
    }

    var body: some View {
        HStack(spacing: Space.xs) {
            Circle()
                .fill(color)
                .frame(width: size, height: size)
            if showsLabel {
                Text(label)
                    .font(.headline)
                    .foregroundStyle(Palette.primaryText)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Flight category \(label)")
    }
}

#Preview {
    HStack(spacing: 16) {
        FlightCategoryDot(category: .vfr)
        FlightCategoryDot(category: .mvfr)
        FlightCategoryDot(category: .ifr)
        FlightCategoryDot(category: .lifr, showsLabel: true)
    }
}
