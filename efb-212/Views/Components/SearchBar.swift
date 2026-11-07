//
//  SearchBar.swift
//  efb-212
//
//  Search input for airport lookup by ICAO, name, or city: magnifying glass, text field and a clear
//  button on the active-cell fill with a hairline edge, 60 pt tall (in-flight target).
//

import SwiftUI

struct SearchBar: View {
    @Binding var text: String
    let placeholder: String
    var focusOnAppear: Bool = false
    let onSubmit: () -> Void

    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(spacing: Space.s) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Palette.inkSecondary)
                .accessibilityHidden(true)  // decorative per UI-SPEC accessibility

            TextField(placeholder, text: $text)
                .textFieldStyle(.plain)
                .font(TypeRole.body)
                .foregroundStyle(Palette.ink)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.characters)  // ICAO IDs are uppercase
                .submitLabel(.search)
                .focused($isFocused)
                .onSubmit(onSubmit)
                .frame(minHeight: StripMetrics.cell)

            if !text.isEmpty {
                Button(action: { text = "" }) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Palette.inkSecondary)
                        .frame(minWidth: StripMetrics.cell, minHeight: StripMetrics.cell)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.leading, Space.m)
        .background(Palette.activeCell)
        .clipShape(RoundedRectangle(cornerRadius: Radius.s))
        .overlay(RoundedRectangle(cornerRadius: Radius.s).strokeBorder(Palette.rule, lineWidth: 1))
        .onAppear {
            if focusOnAppear { isFocused = true }
        }
    }
}

#Preview {
    SearchBar(
        text: .constant("KPAO"),
        placeholder: "Search airports (ICAO, name, city)",
        onSubmit: {}
    )
    .padding()
}
