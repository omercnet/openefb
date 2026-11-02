//
//  IsraelFlightPlanMessage.swift
//  efb-212
//
//  The ICAO FPL text and the Hebrew summary for a routed Israeli CVFR plan, plus the checks that
//  block filing (IL-PLAN). Format: domestic AIP A-11 appendix A,
//      (FPL-4XHLH-VG
//      -ULAC/L-S/C
//      -LLRS1100
//      -N0090VFR NTAIM NSHRM ...
//      -LLMG0100
//      -DOF/220929 RMK/PIC ISRAEL ISRAELI LICENSE 1234 CELL 0541234567
//      -E/0400 P/002)
//  Nothing here sends anything. The pilot files by phone or e-mail to ais@iaa.gov.il (A-11 3b(1)).
//

import Foundation

// MARK: - Input

nonisolated struct IsraelFlightPlanInput: Equatable, Sendable {
    /// Registration as the pilot keeps it ("4X-ABC", "ABC", "4XABC"); normalised by `registrationField`.
    var registration: String
    /// ICAO type designator ("C172"). nil or empty: the message uses ZZZZ and TYP/ `typeDescription`.
    var typeDesignator: String?
    /// Free-text type ("Cessna 172SP"), used for TYP/ when there is no designator.
    var typeDescription: String?
    /// ICAO wake category letter; light aircraft.
    var wakeCategory: String = "L"
    var cruiseSpeedKnots: Double          // knots TAS
    var enduranceSeconds: TimeInterval?   // seconds of fuel on board; nil omits E/
    var personsOnBoard: Int?              // nil omits P/
    var departure: Date                   // planned off-block time, an absolute instant
    var picName: String
    var licenseNumber: String?
    var phone: String?
    var email: String?

    init(
        registration: String, typeDesignator: String? = nil, typeDescription: String? = nil, wakeCategory: String = "L",
        cruiseSpeedKnots: Double, enduranceSeconds: TimeInterval? = nil, personsOnBoard: Int? = nil,
        departure: Date, picName: String, licenseNumber: String? = nil, phone: String? = nil, email: String? = nil
    ) {
        self.registration = registration
        self.typeDesignator = typeDesignator
        self.typeDescription = typeDescription
        self.wakeCategory = wakeCategory
        self.cruiseSpeedKnots = cruiseSpeedKnots
        self.enduranceSeconds = enduranceSeconds
        self.personsOnBoard = personsOnBoard
        self.departure = departure
        self.picName = picName
        self.licenseNumber = licenseNumber
        self.phone = phone
        self.email = email
    }
}

// MARK: - Message

nonisolated enum IsraelFlightPlanMessage {

    /// Where pilots send a domestic route flight plan (AIP A-11 3b(1)). Shown to the pilot; never used to send.
    static let filingAddress = "ais@iaa.gov.il"

    /// Aerodromes with a real ICAO indicator; everything else is ZZZZ with DEP/ or DEST/.
    static func isICAOLocation(_ code: String) -> Bool {
        let letters = Array(code.uppercased())
        return letters.count == 4 && letters[0] == "L" && letters[1] == "L" && letters.allSatisfy { $0.isLetter && $0.isASCII }
    }

    /// "HLH" and "4X-HLH" both give "4XHLH". Registrations that are already full-length keep their prefix.
    static func registrationField(_ registration: String) -> String {
        let cleaned = registration.uppercased().filter { $0.isLetter || $0.isNumber }
        if cleaned.hasPrefix("4X") { return cleaned }
        if cleaned.isEmpty { return "" }
        return cleaned.count <= 3 ? "4X" + cleaned : cleaned
    }

    /// The ICAO FPL text, one field per line as the AIP example shows it.
    static func fpl(plan: IsraelRoutePlan, input: IsraelFlightPlanInput) -> String {
        let points = plan.points
        guard let dep = points.first, let dest = points.last else { return "" }
        let depICAO = isICAOLocation(dep.code), destICAO = isICAOLocation(dest.code)

        var typeField = (input.typeDesignator ?? "").uppercased().filter { $0.isLetter || $0.isNumber }
        let needsTYP = typeField.isEmpty
        if needsTYP { typeField = "ZZZZ" }

        // EET rounds up to the next whole minute; the epsilon absorbs floating-point noise on exact minutes.
        let eet = hhmm(seconds: (plan.totalETESeconds / 60 - 1e-6).rounded(.up) * 60)
        let speed = String(format: "N%04d", Int(input.cruiseSpeedKnots.rounded()))
        let via = points.dropFirst().dropLast().map(\.code)
        let route = via.isEmpty ? "DCT" : via.joined(separator: " ")

        var field18: [String] = []
        if !depICAO { field18.append("DEP/\(dep.code.uppercased())") }
        if !destICAO { field18.append("DEST/\(dest.code.uppercased())") }
        if needsTYP, let text = input.typeDescription, !text.isEmpty {
            field18.append("TYP/\(sanitised(text))")
        }
        field18.append("DOF/\(utcDate(input.departure, format: "yyMMdd"))")
        field18.append("RMK/" + remarks(input))

        var lines = [
            "(FPL-\(registrationField(input.registration))-VG",
            "-\(typeField)/\(input.wakeCategory.uppercased())-S/C",
            "-\(depICAO ? dep.code.uppercased() : "ZZZZ")\(utcDate(input.departure, format: "HHmm"))",
            "-\(speed)VFR \(route)",
            "-\(destICAO ? dest.code.uppercased() : "ZZZZ")\(eet)",
            "-" + field18.joined(separator: " ")
        ]
        var last = ""
        if let endurance = input.enduranceSeconds { last += "-E/\(hhmm(seconds: endurance))" }
        if let pob = input.personsOnBoard { last += (last.isEmpty ? "-" : " ") + String(format: "P/%03d", pob) }
        if last.isEmpty {
            lines[lines.count - 1] += ")"
        } else {
            lines.append(last + ")")
        }
        return lines.joined(separator: "\n")
    }

    /// The Hebrew summary pilots paste next to the message. Times are local Israel time.
    static func hebrewSummary(plan: IsraelRoutePlan, input: IsraelFlightPlanInput) -> String {
        let points = plan.points
        guard let dep = points.first, let dest = points.last else { return "" }
        let eta = input.departure.addingTimeInterval(plan.totalETESeconds)
        let route = points.map(\.code).joined(separator: " ")
        return "תכנית טיסה בנתיבי התובלה הנמוכים, "
            + "המראה מ\(hebrewName(dep)) ב-\(israelDate(input.departure)) בשעה \(israelTime(input.departure)) זמן מקומי, "
            + "נתיב: \(route), "
            + "נחיתה ב\(hebrewName(dest)) בשעה \(israelTime(eta)) זמן מקומי"
    }

    // MARK: Pieces

    private static func remarks(_ input: IsraelFlightPlanInput) -> String {
        var parts = ["PIC \(sanitised(input.picName))"]
        if let license = input.licenseNumber, !license.isEmpty { parts.append("LICENSE \(sanitised(license))") }
        if let phone = input.phone, !phone.isEmpty { parts.append("CELL \(phone.filter { $0.isNumber })") }
        return parts.joined(separator: " ")
    }

    /// FPL free text is upper-case ASCII without brackets or hyphens that would split a field.
    private static func sanitised(_ text: String) -> String {
        let folded = text.folding(options: [.diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX")).uppercased()
        return folded.map { ch -> Character in
            (ch.isASCII && (ch.isLetter || ch.isNumber || ch == " " || ch == "/")) ? ch : " "
        }.reduce(into: "") { $0.append($1) }
            .split(separator: " ", omittingEmptySubsequences: true).joined(separator: " ")
    }

    /// "HHMM" for a duration -- seconds.
    static func hhmm(seconds: TimeInterval) -> String {
        let minutes = max(0, Int(seconds / 60))
        return String(format: "%02d%02d", minutes / 60, minutes % 60)
    }

    private static func utcDate(_ date: Date, format: String) -> String {
        formatted(date, format: format, zone: TimeZone(identifier: "UTC") ?? .gmt)
    }

    private static func israelTime(_ date: Date) -> String {
        formatted(date, format: "HH:mm", zone: TimeZone(identifier: "Asia/Jerusalem") ?? .gmt)
    }

    private static func israelDate(_ date: Date) -> String {
        formatted(date, format: "dd.MM.yyyy", zone: TimeZone(identifier: "Asia/Jerusalem") ?? .gmt)
    }

    private static func formatted(_ date: Date, format: String, zone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = zone
        formatter.dateFormat = format
        return formatter.string(from: date)
    }

    private static func hebrewName(_ point: IsraelReportingPoint) -> String {
        let name = (point.nameHebrew ?? "").trimmingCharacters(in: .whitespaces)
        return name.isEmpty ? point.code : name
    }
}

// MARK: - Validation

nonisolated struct IsraelFlightPlanIssue: Hashable, Sendable, Identifiable {
    enum Kind: Hashable, Sendable {
        case byRequestSegment(String)     // segment "FROM-TO"
        case militarySegment(String)
        case wrongWay(String)             // one-way segment flown against its published direction
        case closedSegment(String)        // fully closed by NOTAM; value is "FROM-TO (NOTAM id)"
        case checkNotam(String)
        case closuresNotChecked
        case missingPilotField(String)    // "license", "phone", "name"
        case missingAircraftField(String) // "endurance", "persons on board", "registration"
    }

    let kind: Kind
    /// true: "File" stays disabled until the route changes.
    let blocksFiling: Bool
    var id: Kind { kind }

    /// English text for the preview sheet.
    var message: String {
        switch kind {
        case .byRequestSegment(let s): return "\(s) is a by-request route. It needs real-time ATC approval and cannot be filed."
        case .militarySegment(let s): return "\(s) is a military route. It needs IAF approval and cannot be filed."
        case .wrongWay(let s): return "\(s) is a one-way route flown against its published direction."
        case .closedSegment(let s): return "\(s) is closed by NOTAM."
        case .checkNotam(let id): return "NOTAM \(id) may close part of this route and could not be read in full. Read it before filing."
        case .closuresNotChecked: return "NOTAM closures were not checked: the feed is missing or out of date."
        case .missingPilotField(let f): return "Pilot \(f) is missing from the pilot profile."
        case .missingAircraftField(let f): return "Aircraft \(f) is missing from the aircraft profile."
        }
    }

    /// The disclaimer shown with every preview (fpl.co.il shows the same duty).
    static let disclaimer = "The pilot in command is responsible for checking the AIP, NOTAMs and weather. "
        + "This app does not file anything: send the message to \(IsraelFlightPlanMessage.filingAddress) yourself."
}

nonisolated enum IsraelFlightPlanValidator {

    /// - Parameters:
    ///   - closures: segment closure marks for the planned window; empty with `closuresChecked == false` when the feed was missing or stale.
    static func validate(
        plan: IsraelRoutePlan,
        closures: [Int: IsraelSegmentClosure] = [:],
        closuresChecked: Bool = true,
        input: IsraelFlightPlanInput? = nil
    ) -> [IsraelFlightPlanIssue] {
        var issues: [IsraelFlightPlanIssue] = []
        func add(_ kind: IsraelFlightPlanIssue.Kind, blocks: Bool) {
            let issue = IsraelFlightPlanIssue(kind: kind, blocksFiling: blocks)
            if !issues.contains(issue) { issues.append(issue) }
        }
        for leg in plan.legs {
            let name = "\(leg.from.code)-\(leg.to.code)"
            if leg.segment.isByRequest { add(.byRequestSegment(name), blocks: true) }
            if leg.segment.isMilitary { add(.militarySegment(name), blocks: true) }
            if leg.segment.altitude(forward: leg.forward) == nil { add(.wrongWay(name), blocks: true) }
            switch closures[leg.segment.id] {
            case .full(let id): add(.closedSegment("\(name) (\(id))"), blocks: true)
            case .check(let id): add(.checkNotam(id), blocks: true)
            case .partial, .none: break
            }
        }
        if !closuresChecked { add(.closuresNotChecked, blocks: false) }
        if let input {
            if IsraelFlightPlanMessage.registrationField(input.registration).isEmpty { add(.missingAircraftField("registration"), blocks: true) }
            if input.enduranceSeconds == nil { add(.missingAircraftField("endurance"), blocks: false) }
            if input.personsOnBoard == nil { add(.missingAircraftField("persons on board"), blocks: false) }
            if input.picName.trimmingCharacters(in: .whitespaces).isEmpty { add(.missingPilotField("name"), blocks: true) }
            if (input.licenseNumber ?? "").isEmpty { add(.missingPilotField("license"), blocks: false) }
            if (input.phone ?? "").isEmpty { add(.missingPilotField("phone"), blocks: false) }
        }
        return issues
    }

    static func canFile(_ issues: [IsraelFlightPlanIssue]) -> Bool { !issues.contains(where: \.blocksFiling) }
}
