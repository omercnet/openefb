//
//  SearchColumnView.swift
//  efb-212
//
//  Airport search in the strip column: a search field, focused when the column opens, and 60 pt result
//  rows. Selecting a result hands its identifier to `onSelect` (which opens the airport column).
//

import SwiftUI

struct SearchColumnView: View {
    private let searchViewModel: SearchViewModel
    private let onSelect: (String) -> Void

    init(searchViewModel: SearchViewModel, onSelect: @escaping (String) -> Void) {
        self.searchViewModel = searchViewModel
        self.onSelect = onSelect
    }

    var body: some View {
        @Bindable var searchViewModel = self.searchViewModel

        VStack(spacing: 0) {
            ColumnHeader {
                Text("Search")
                    .font(TypeRole.title)
                    .foregroundStyle(Palette.ink)
                    .accessibilityAddTraits(.isHeader)
            }
            SearchBar(
                text: $searchViewModel.query,
                placeholder: "ICAO, name or city",
                focusOnAppear: true,
                onSubmit: { searchViewModel.search() }
            )
            .accessibilityLabel("Search airports")
            .padding(Space.l)
            .onChange(of: searchViewModel.query) { _, _ in
                searchViewModel.search()
            }
            ColumnRule()

            ScrollView {
                if !searchViewModel.results.isEmpty {
                    LazyVStack(spacing: 0) {
                        ForEach(searchViewModel.results) { airport in
                            resultRow(airport)
                            ColumnRule()
                        }
                    }
                } else if searchViewModel.isSearching {
                    ProgressView("Searching\u{2026}")
                        .font(TypeRole.caption)
                        .padding(Space.l)
                } else if searchViewModel.query.trimmingCharacters(in: .whitespaces).count >= 2 {
                    Text("No airports match \u{201C}\(searchViewModel.query)\u{201D}")
                        .font(TypeRole.caption)
                        .foregroundStyle(Palette.inkSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(Space.l)
                        .accessibilityIdentifier("search-no-results")
                }
            }
        }
        .foregroundStyle(Palette.ink)
        .background(Palette.paper)
    }

    private func resultRow(_ airport: Airport) -> some View {
        Button {
            onSelect(airport.icao)
            searchViewModel.clear()
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: Space.m) {
                Text(airport.icao)
                    .font(TypeRole.rowIdent)
                    .foregroundStyle(Palette.airspace)
                    .lineLimit(1)
                    .fixedSize()
                Text(airport.name)
                    .font(TypeRole.body)
                    .foregroundStyle(Palette.inkSecondary)
                    .multilineTextAlignment(.leading)
            }
            .padding(.horizontal, Space.l)
            .padding(.vertical, Space.s)
            .frame(maxWidth: .infinity, minHeight: StripMetrics.cell, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableButtonStyle())
        .accessibilityElement(children: .combine)
        .accessibilityHint("Shows airport information")
    }
}
