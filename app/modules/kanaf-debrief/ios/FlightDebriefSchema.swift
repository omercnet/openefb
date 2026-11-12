//
//  FlightDebriefSchema.swift
//  KanafDebrief
//
//  The @Generable schema the on-device model fills in, copied from efb-212/Services/Debrief/DebriefTypes.swift. The guide
//  descriptions are part of what the model is told, so the wording stays identical. The TypeScript twin is FlightDebrief in
//  src/domain/debrief/types.ts; src/domain/debriefResponse.ts checks the JSON this schema produces. Keep the three in step
//  until the Swift app is deleted.
//

import FoundationModels

@available(iOS 26.0, *)
@Generable
struct FlightDebrief {
    @Guide(description: "A concise narrative summary of the entire flight in 2-3 sentences.")
    let narrativeSummary: String

    @Guide(description: "Observations grouped by detected flight phase.")
    let phaseObservations: [PhaseObservation]

    @Guide(description: "Specific, actionable improvement suggestions for the pilot.")
    let improvements: [String]

    @Guide(description: "Overall flight rating.", .range(1...5))
    let overallRating: Int
}

/// Per-phase observation within a flight debrief.
@available(iOS 26.0, *)
@Generable
struct PhaseObservation {
    @Guide(description: "Flight phase name: preflight, taxi, takeoff, departure, cruise, approach, landing, or postflight.")
    let phase: String

    @Guide(description: "Key observations during this phase.")
    let observations: [String]

    @Guide(description: "Whether this phase was executed well.")
    let executedWell: Bool
}
