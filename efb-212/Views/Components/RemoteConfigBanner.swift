//
//  RemoteConfigBanner.swift
//  efb-212
//
//  Non-blocking notices from the remote config (RemoteConfigStore), shown on every tab under the
//  database banner: the "please update" request when the build is below `minSupportedBuild`, and the
//  file's notices for the current region. Amber (caution) or blue (info), never red. Each can be
//  dismissed for the session. It never covers the map controls and never blocks flying.
//

import SwiftUI

struct RemoteConfigBanner: View {
    @Environment(AppState.self) private var appState
    @State private var store = RemoteConfigStore.shared

    /// The App Store page for "Kanaf EFB" (app 6829641724).
    static let appStoreURL = URL(string: "https://apps.apple.com/app/id6829641724")

    struct Item: Identifiable, Equatable {
        let id: String
        let text: String
        let isCaution: Bool
        let offersUpdate: Bool
    }

    private var items: [Item] {
        var result: [Item] = []
        if case .required(let text)? = store.updateRequest, !store.dismissedBannerIDs.contains(RemoteConfigStore.updateBannerID) {
            result.append(Item(id: RemoteConfigStore.updateBannerID, text: text, isCaution: true, offersUpdate: true))
        }
        for notice in store.notices(for: appState.region) {
            result.append(Item(id: notice.id, text: notice.text.resolved(), isCaution: notice.severity == .caution, offersUpdate: false))
        }
        return result
    }

    var body: some View {
        let items = items
        if !items.isEmpty {
            VStack(spacing: 6) {
                ForEach(items) { item in row(item) }
            }
            .padding(.horizontal, 16)
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            .accessibilityIdentifier("remoteConfigBanner")
        }
    }

    private func row(_ item: Item) -> some View {
        HStack(alignment: .center, spacing: 10) {
            Image(systemName: item.isCaution ? "exclamationmark.triangle.fill" : "info.circle")
                .foregroundStyle(item.isCaution ? Palette.caution : Palette.accentText)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.text)
                    .font(.footnote)
                    .foregroundStyle(Palette.primaryText)
                if item.offersUpdate, let url = Self.appStoreURL {
                    Link("Open the App Store", destination: url)
                        .font(.footnote.bold())
                }
            }
            Spacer(minLength: 0)
            Button {
                store.dismissBanner(item.id)
            } label: {
                Image(systemName: "xmark")
                    .font(.footnote)
                    .foregroundStyle(Palette.secondaryText)
                    .frame(minWidth: 44, minHeight: 44)
            }
            .accessibilityLabel("Dismiss notice")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
        .background(item.isCaution ? Palette.caution.opacity(0.15) : Palette.infoFill)
        .clipShape(RoundedRectangle(cornerRadius: Radius.s))
    }
}
