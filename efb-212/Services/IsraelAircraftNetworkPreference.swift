//
//  IsraelAircraftNetworkPreference.swift
//  efb-212
//
//  Which Israeli route network an aircraft usually flies: CVFR for GA, the sport-aviation (LSA) network for
//  LSA and ultralight aircraft. The planner preselects it from the active aircraft; the pilot can still pick.
//
//  Kept beside the profile, not in it: a new SchemaV1 attribute needs a SchemaV2 migration, and one string per
//  aircraft is not worth that. The key is the profile's UUID, so renaming the aircraft keeps it.
//

import Foundation

nonisolated enum IsraelAircraftNetworkPreference {

    private static func key(_ profileID: UUID) -> String { "israel.routeNetwork." + profileID.uuidString }

    /// nil when the pilot has not said (the planner then starts on CVFR).
    static func network(for profileID: UUID, defaults: UserDefaults = .standard) -> IsraelRouteNetwork? {
        defaults.string(forKey: key(profileID)).flatMap(IsraelRouteNetwork.init(rawValue:))
    }

    /// Pass nil to clear the preference.
    static func set(_ network: IsraelRouteNetwork?, for profileID: UUID, defaults: UserDefaults = .standard) {
        if let network {
            defaults.set(network.rawValue, forKey: key(profileID))
        } else {
            defaults.removeObject(forKey: key(profileID))
        }
    }
}
