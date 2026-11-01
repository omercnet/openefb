//
//  LogbookListView.swift
//  efb-212
//
//  Chronological logbook list with confirmed/unconfirmed indicators,
//  manual entry creation, and summary footer. Shown as the Logbook section of the Flights
//  tab, inside its NavigationStack (T22).
//  Confirmed entries navigate to read-only detail; unconfirmed to editable view.
//

import SwiftUI
import SwiftData

struct LogbookListView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.modelContext) private var modelContext

    @State private var viewModel: LogbookViewModel?

    var body: some View {
        Group {
            if let vm = viewModel {
                if vm.entries.isEmpty {
                    ContentUnavailableView {
                        Label("No entries yet", systemImage: "book.closed")
                    } description: {
                        Text("Recorded flights appear here. Add an entry with +.")
                    }
                } else {
                    logbookList(vm: vm)
                }
            } else {
                ProgressView("Loading...")
            }
        }
        .navigationTitle("Logbook")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    addManualEntry()
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Add logbook entry")
            }
        }
        .sheet(isPresented: Binding(
            get: { viewModel?.isShowingManualEntry ?? false },
            set: { viewModel?.isShowingManualEntry = $0 }
        )) {
            if let vm = viewModel, let entry = vm.selectedEntry {
                NavigationStack {
                    LogbookEntryEditView(entry: entry, viewModel: vm, isReadOnly: false)
                        .navigationTitle("New Entry")
                }
            }
        }
        .onAppear {
            initializeViewModel()
        }
    }

    // MARK: - Logbook List

    @ViewBuilder
    private func logbookList(vm: LogbookViewModel) -> some View {
        List {
            ForEach(vm.entries, id: \.id) { entry in
                NavigationLink {
                    LogbookEntryEditView(
                        entry: entry,
                        viewModel: vm,
                        isReadOnly: entry.isConfirmed
                    )
                } label: {
                    LogbookEntryRow(entry: entry)
                }
            }
            .onDelete { indexSet in
                deleteEntries(at: indexSet, vm: vm)
            }

            // Summary footer
            Section {
                HStack {
                    Text("Total")
                        .fontWeight(.semibold)
                    Spacer()
                    Text("\(vm.totalFlights) flights")
                    Text("  ")
                    Text("\(LogbookViewModel.formatDurationDecimal(vm.totalFlightTimeSeconds))h")
                        .fontWeight(.medium)
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .accessibilityElement(children: .combine)
            }
        }
    }

    // MARK: - Entry Row

    private struct LogbookEntryRow: View {
        let entry: SchemaV1.LogbookEntry

        private static let dateFormatter: DateFormatter = {
            let f = DateFormatter()
            f.dateFormat = "MMM d, yyyy"
            return f
        }()

        var body: some View {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(Self.dateFormatter.string(from: entry.date))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Text("\(entry.departureICAO ?? "---") -> \(entry.arrivalICAO ?? "---")")
                        .font(.body)
                        .fontWeight(.medium)
                        .accessibilityLabel("\(entry.departureICAO ?? "Unknown") to \(entry.arrivalICAO ?? "Unknown")")
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 4) {
                    Text("\(LogbookViewModel.formatDurationDecimal(entry.durationSeconds))h")
                        .font(.subheadline)
                        .fontWeight(.medium)
                    Text(entry.aircraftType ?? "Unknown")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if entry.isConfirmed {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                        .padding(.leading, 4)
                        .accessibilityLabel("Confirmed")
                } else {
                    Image(systemName: "pencil.circle")
                        .foregroundStyle(.orange)
                        .padding(.leading, 4)
                        .accessibilityLabel("Draft, not confirmed")
                }
            }
            .padding(.vertical, 2)
            .accessibilityElement(children: .combine)
        }
    }

    // MARK: - Actions

    private func initializeViewModel() {
        if viewModel == nil {
            let vm = LogbookViewModel()
            vm.loadEntries(modelContext: modelContext)
            viewModel = vm
        } else {
            viewModel?.loadEntries(modelContext: modelContext)
        }
    }

    private func addManualEntry() {
        guard let vm = viewModel else { return }
        let entry = vm.createManualEntry(modelContext: modelContext)
        vm.selectedEntry = entry
        vm.isShowingManualEntry = true
    }

    private func deleteEntries(at offsets: IndexSet, vm: LogbookViewModel) {
        for index in offsets {
            let entry = vm.entries[index]
            // Only allow deleting unconfirmed entries
            guard !entry.isConfirmed else { continue }
            vm.deleteEntry(entry, modelContext: modelContext)
        }
        vm.loadEntries(modelContext: modelContext)
    }
}

#Preview {
    LogbookListView()
        .environment(AppState())
        .modelContainer(for: [
            SchemaV1.LogbookEntry.self,
            SchemaV1.UserSettings.self
        ])
}
