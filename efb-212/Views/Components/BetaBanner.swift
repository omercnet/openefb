//
//  BetaBanner.swift
//  efb-212
//
//  Dismissable beta notice shown until first dismissed; after that the same line lives in
//  Settings > About. Uses @AppStorage("hasDismissedBetaBanner") for persistence.
//  Declared in PrivacyInfo.xcprivacy UserDefaults reason CA92.1.
//

import SwiftUI

struct BetaBanner: View {
    @AppStorage("hasDismissedBetaBanner") private var dismissed = false

    var body: some View {
        if !dismissed {
            HStack {
                Image(systemName: "info.circle")
                    .foregroundStyle(Palette.accentText)
                Text("Beta build. Report problems in Settings › Feedback.")
                    .font(.footnote)
                    .foregroundStyle(Palette.primaryText)
                Spacer()
                Button {
                    dismissed = true
                } label: {
                    Image(systemName: "xmark")
                        .font(.footnote)
                        .foregroundStyle(Palette.secondaryText)
                        .frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityLabel("Dismiss beta notice")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Palette.infoFill)
            .clipShape(RoundedRectangle(cornerRadius: Radius.s))
            .padding(.horizontal, 16)
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        }
    }
}

#Preview("Visible") {
    BetaBanner()
}
