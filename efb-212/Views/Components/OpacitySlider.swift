//
//  OpacitySlider.swift
//  efb-212
//
//  Slider for adjusting VFR sectional chart overlay opacity (0-100%).
//  Bound to AppState.sectionalOpacity.
//

import SwiftUI

struct OpacitySlider: View {
    @Binding var opacity: Double

    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            HStack {
                Text("Opacity")
                    .font(TypeRole.label)
                    .foregroundStyle(Palette.secondaryText)
                Spacer()
                Text("\(Int(opacity * 100))%")
                    .font(TypeRole.valueSmall)
                    .foregroundStyle(Palette.primaryText)
            }
            .accessibilityHidden(true)  // the slider below speaks label and value

            Slider(value: $opacity, in: 0.0...1.0)
                .frame(minHeight: 44)
                .accessibilityLabel("Sectional chart opacity")
                .accessibilityValue("\(Int(opacity * 100)) percent")
        }
    }
}

#Preview {
    OpacitySlider(opacity: .constant(0.70))
        .frame(width: 240)
        .padding()
}
