//
//  IsraelFlightPlanView.swift
//  efb-212
//
//  Israel planning (IL-PLAN): departure, destination and via points, auto-routed over the open CVFR
//  network, a legs table with the published altitude per leg, closure and approval badges, the FPL
//  preview with share and e-mail, a return flight, and Activate. Red = blocks filing, amber = caution.
//

import SwiftUI
import SwiftData

struct IsraelFlightPlanView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.modelContext) private var modelContext

    @State private var viewModel: IsraelFlightPlanViewModel?
    @State private var showPreview = false
    @State private var showBriefing = false

    var body: some View {
        Group {
            if let viewModel {
                content(viewModel)
            } else {
                ProgressView("Loading...")
            }
        }
        .onAppear {
            guard viewModel == nil else { return }
            let vm = IsraelFlightPlanViewModel(appState: appState)
            vm.configure(mapService: appState.sharedMapService, modelContext: modelContext)
            viewModel = vm
        }
    }

    // MARK: - Content

    @ViewBuilder
    private func content(_ vm: IsraelFlightPlanViewModel) -> some View {
        @Bindable var vm = vm
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                networkPicker(vm)
                picker(title: "Departure", query: $vm.departureQuery, results: vm.departureResults,
                       label: "Departure aerodrome", onChange: vm.searchDeparture, onSelect: vm.selectDeparture)
                picker(title: "Destination", query: $vm.destinationQuery, results: vm.destinationResults,
                       label: "Destination aerodrome", onChange: vm.searchDestination, onSelect: vm.selectDestination)
                viaSection(vm)

                DatePicker("Departure (local)", selection: $vm.departureTime, in: Date()...)
                    .environment(\.timeZone, TimeZone(identifier: "Asia/Jerusalem") ?? .current)
                    .accessibilityIdentifier("il-departure-time")

                if vm.network == .lsa { lsaWeekendSection(vm) }

                overrides(vm)

                if let error = vm.routeError {
                    noRouteBanner(error)
                }
                if let plan = vm.plan {
                    summary(plan, vm)
                    legsTable(plan)
                    issuesList(vm)
                    actions(vm)
                }
                Button { showBriefing = true } label: {
                    Label("NOTAM briefing", systemImage: "doc.text.magnifyingglass").frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("il-notam-briefing")
                Text(IsraelFlightPlanIssue.disclaimer)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding()
        }
        .scrollDismissesKeyboard(.interactively)
        .sheet(isPresented: $showPreview) { previewSheet(vm) }
        .sheet(isPresented: $showBriefing) {
            IsraelBriefingView(plannedRoute: vm.plan.map { BriefingRoute(plan: $0, departure: vm.departureTime) })
        }
    }

    // MARK: - Pickers

    @ViewBuilder
    private func picker(
        title: String, query: Binding<String>, results: [IsraelAerodrome], label: String,
        onChange: @escaping () -> Void, onSelect: @escaping (IsraelAerodrome) -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            TextField("ICAO, English or Hebrew name", text: query)
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
                .accessibilityLabel(label)
                .onChange(of: query.wrappedValue) { _, _ in onChange() }
            ForEach(results) { aerodrome in
                Button {
                    onSelect(aerodrome)
                    // The result tapped, the keyboard has done its job: it would hide the summary and legs.
                    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                } label: {
                    HStack {
                        Text(aerodrome.code).font(.system(.body, design: .monospaced).weight(.semibold))
                        Text(aerodrome.nameEnglish).lineLimit(1)
                        Spacer()
                        Text(aerodrome.nameHebrew).foregroundStyle(.secondary).lineLimit(1)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder
    private func viaSection(_ vm: IsraelFlightPlanViewModel) -> some View {
        @Bindable var vm = vm
        VStack(alignment: .leading, spacing: 4) {
            Text("Via points (optional)").font(.caption).foregroundStyle(.secondary)
            ForEach(Array(vm.viaCodes.enumerated()), id: \.offset) { index, code in
                HStack {
                    Text(code).font(.system(.body, design: .monospaced).weight(.semibold))
                    Spacer()
                    Button { vm.removeVia(at: index) } label: {
                        Image(systemName: "minus.circle").frame(width: 44, height: 44)
                    }
                    .accessibilityLabel("Remove via \(code)")
                }
            }
            HStack {
                TextField("Reporting point code (e.g. TAVOR)", text: $vm.viaQuery)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .accessibilityLabel("Via point")
                    .onSubmit { vm.addVia(code: vm.viaQuery) }
                Button("Add") { vm.addVia(code: vm.viaQuery) }
                    .buttonStyle(.bordered)
                    .frame(minHeight: 44)
            }
            if let error = vm.viaError {
                Text(error).font(.caption).foregroundStyle(Palette.warning)
            }
        }
    }

    @ViewBuilder
    private func overrides(_ vm: IsraelFlightPlanViewModel) -> some View {
        @Bindable var vm = vm
        DisclosureGroup("Route options") {
            Toggle("Allow by-request routes (ATC approval, not fileable)", isOn: $vm.allowByRequest)
            Toggle("Allow military routes (IAF approval, not fileable)", isOn: $vm.allowMilitary)
        }
    }

    /// CVFR or sport aviation (LSA). The aircraft's usual network preselects it; a tap here overrides that.
    @ViewBuilder
    private func networkPicker(_ vm: IsraelFlightPlanViewModel) -> some View {
        Picker("Route network", selection: Binding(get: { vm.network }, set: { vm.selectNetwork($0) })) {
            Text("CVFR").tag(IsraelRouteNetwork.cvfr)
            Text("LSA (sport aviation)").tag(IsraelRouteNetwork.lsa)
        }
        .pickerStyle(.segmented)
        .controlSize(.large)
        .accessibilityLabel("Route network")
        .accessibilityIdentifier("il-route-network")
    }

    /// LSA only: the pilot's holiday declaration and the AIP's weekend definition, as published.
    @ViewBuilder
    private func lsaWeekendSection(_ vm: IsraelFlightPlanViewModel) -> some View {
        @Bindable var vm = vm
        Picker("Departure day", selection: $vm.dayOverride) {
            Text("Normal day").tag(IsraelDayOverride.none)
            Text("Holiday eve").tag(IsraelDayOverride.holidayEve)
            Text("Holiday").tag(IsraelDayOverride.holiday)
        }
        .accessibilityIdentifier("il-day-override")
        DisclosureGroup("Weekend-only routes (AIP B-08)") {
            VStack(alignment: .leading, spacing: 8) {
                if let rule = vm.weekendRule {
                    Text(rule.textEnglish)
                    Text(rule.textHebrew).environment(\.layoutDirection, .rightToLeft)
                    Text("Source: \(rule.source). The route data does not say which Friday start applies to which route, and has no holiday calendar, so declare a holiday above.")
                        .foregroundStyle(.secondary)
                } else {
                    Text("Routes marked weekend run on Saturdays and holidays all day and Fridays from 06:00 (some areas from 12:00 or 14:00), holiday eves from 14:00 (AIP B-08).")
                }
            }
            .font(.footnote)
        }
        .accessibilityIdentifier("il-weekend-rule")
    }

    // MARK: - Result

    private func noRouteBanner(_ error: IsraelRouteError) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(error.errorDescription ?? "No route", systemImage: "exclamationmark.octagon.fill")
                .font(.headline)
                .foregroundStyle(Palette.warning)
            Text(error.hebrewDescription)
                .font(.subheadline)
                .environment(\.layoutDirection, .rightToLeft)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.warning.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
        .accessibilityIdentifier("il-no-route")
    }

    private func summary(_ plan: IsraelRoutePlan, _ vm: IsraelFlightPlanViewModel) -> some View {
        let hours = Int(plan.totalETESeconds) / 3600, minutes = (Int(plan.totalETESeconds) % 3600) / 60
        return HStack(spacing: 24) {
            summaryCell("DIST", String(format: "%.1f NM", plan.totalDistanceNM))
            summaryCell("ETE", String(format: "%d:%02d", hours, minutes))
            summaryCell("TAS", String(format: "%.0f KT", plan.cruiseSpeedKnots))
            summaryCell("LEGS", "\(plan.legs.count)")
        }
        .accessibilityIdentifier("il-summary")
    }

    private func summaryCell(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.system(.title3, design: .monospaced).weight(.bold))
        }
    }

    private func legsTable(_ plan: IsraelRoutePlan) -> some View {
        VStack(spacing: 0) {
            HStack {
                Text("FROM \u{2192} TO").frame(maxWidth: .infinity, alignment: .leading)
                Text("ALT FT").frame(width: 90, alignment: .trailing)
                Text("NM").frame(width: 56, alignment: .trailing)
                Text("ETE MIN").frame(width: 56, alignment: .trailing)
            }
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.secondary)
            .padding(.vertical, 6)
            Divider()
            ForEach(plan.legs) { leg in
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text("\(leg.from.code) \u{2192} \(leg.to.code)")
                            .font(.system(.body, design: .monospaced).weight(.semibold))
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text(leg.altitudeText).frame(width: 90, alignment: .trailing)
                        Text(String(format: "%.1f", leg.distanceNM)).frame(width: 56, alignment: .trailing)
                        Text(String(format: "%.0f", (leg.eteSeconds / 60).rounded()))
                            .frame(width: 56, alignment: .trailing)
                    }
                    .font(.system(.body, design: .monospaced))
                    ForEach(Array(leg.cautions.enumerated()), id: \.offset) { _, caution in
                        badge(caution)
                    }
                }
                .padding(.vertical, 8)
                Divider()
            }
        }
        .accessibilityIdentifier("il-legs")
    }

    private func badge(_ caution: IsraelRouteCaution) -> some View {
        let text: String
        if case .partialClosure(let id, let label) = caution { text = "\(caution.badge) \u{00B7} \(label) (\(id))" }
        else if case .checkNotam(let id) = caution { text = "\(caution.badge) \(id)" }
        else { text = caution.badge }
        let color = caution.blocksFiling ? Palette.warning : Palette.caution
        return Text(text)
            .font(.caption.weight(.bold))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.18), in: Capsule())
            .foregroundStyle(color)
    }

    @ViewBuilder
    private func issuesList(_ vm: IsraelFlightPlanViewModel) -> some View {
        ForEach(vm.issues) { issue in
            Label(issue.message, systemImage: issue.blocksFiling ? "xmark.octagon.fill" : "exclamationmark.triangle.fill")
                .font(.subheadline)
                .foregroundStyle(issue.blocksFiling ? Palette.warning : Palette.caution)
        }
    }

    // MARK: - Actions

    @ViewBuilder
    private func actions(_ vm: IsraelFlightPlanViewModel) -> some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                Button { showPreview = true } label: {
                    Label("FPL message", systemImage: "doc.text").frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent).tint(Palette.accent)
                .disabled(!vm.canFile)
                .accessibilityIdentifier("il-fpl-preview")

                Button { Task { await vm.planReturn() } } label: {
                    Label("Return flight", systemImage: "arrow.uturn.backward").frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("il-return")
            }
            HStack(spacing: 12) {
                Button { vm.activate() } label: {
                    Label(vm.isActive ? "Active" : "Activate", systemImage: "location.north.line.fill")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.bordered)
                .disabled(!vm.canFile || vm.isActive)
                .accessibilityIdentifier("il-activate")

                if let windy = vm.windyURL {
                    Link(destination: windy) {
                        Label("Route weather", systemImage: "wind").frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                }
                Button(role: .destructive) { vm.clear() } label: {
                    Label("Clear", systemImage: "xmark.circle").frame(minHeight: 44)
                }
                .buttonStyle(.bordered)
            }
        }
    }

    // MARK: - FPL preview

    @ViewBuilder
    private func previewSheet(_ vm: IsraelFlightPlanViewModel) -> some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(vm.fplText)
                        .font(.system(.body, design: .monospaced))
                        .textSelection(.enabled)
                        .padding()
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Palette.fill, in: RoundedRectangle(cornerRadius: 10))
                        .accessibilityIdentifier("il-fpl-text")

                    Text(vm.hebrewSummary)
                        .font(.body)
                        .environment(\.layoutDirection, .rightToLeft)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .trailing)

                    ForEach(vm.issues.filter { !$0.blocksFiling }) { issue in
                        Label(issue.message, systemImage: "exclamationmark.triangle.fill")
                            .font(.subheadline).foregroundStyle(Palette.caution)
                    }

                    Text("File by phone or by e-mail to \(IsraelFlightPlanMessage.filingAddress), at least 60 minutes before departure (AIP A-11). The app never sends it for you.")
                        .font(.footnote).foregroundStyle(.secondary)
                    Text(IsraelFlightPlanIssue.disclaimer).font(.footnote).foregroundStyle(.secondary)

                    HStack(spacing: 12) {
                        ShareLink(item: vm.fplText + "\n\n" + vm.hebrewSummary) {
                            Label("Share", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.borderedProminent).tint(Palette.accent)
                        if let mail = vm.mailURL() {
                            Link(destination: mail) {
                                Label("E-mail", systemImage: "envelope").frame(maxWidth: .infinity, minHeight: 44)
                            }
                            .buttonStyle(.bordered)
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("FPL message")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { showPreview = false } }
            }
            .onAppear { vm.refreshMessage() }
        }
        .presentationDetents([.large])
    }
}
