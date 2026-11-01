//
//  NASR Importer
//  Generates the bundled aviation.sqlite database for OpenEFB.
//
//  Primary source: FAA NASR 28-day subscription CSVs (APT_BASE, APT_RWY, APT_RWY_END, FRQ, AWOS,
//  NAV_BASE) from https://nfdc.faa.gov/webContent/28DaySub/extra/<DD_Mon_YYYY>_CSV.zip.
//  Airspace source: FAA AIS "Class_Airspace" ArcGIS feature service (Class B/C/D polygons).
//  Fallback (OurAirports airports.csv + runways.csv, optional): runway end coordinates for the ~400
//  runways NASR has no surveyed ends for, and mixed-case airport names (NASR names are all caps).
//  NASR has every other field the schema needs.
//
//  Usage:
//    swift run nasr-importer --download --output efb-212/Resources/aviation.sqlite
//    swift run nasr-importer --nasr-dir /tmp/nasr/cycle --airspace-geojson /tmp/nasr/class_airspace.geojson \
//        --output efb-212/Resources/aviation.sqlite
//
//  Units: coordinates are WGS84 decimal degrees; elevations feet MSL; runway lengths feet;
//  frequencies MHz (NDB kHz); magnetic variation degrees, east positive / west negative.
//

import Foundation
import GRDB
import ArgumentParser

// MARK: - CLI

@main
struct NASRImporter: ParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "nasr-importer",
        abstract: "Generate aviation.sqlite from FAA NASR CSV data for OpenEFB."
    )

    @Flag(name: .long, help: "Download the current NASR CSV zip and the Class B/C/D airspace polygons")
    var download = false

    @Option(name: .long, help: "NASR cycle effective date (YYYY-MM-DD) to download; default: current cycle")
    var cycle: String?

    @Option(name: .long, help: "Directory containing extracted NASR CSVs (APT_BASE.csv etc.)")
    var nasrDir: String?

    @Option(name: .long, help: "GeoJSON FeatureCollection of Class B/C/D airspace (FAA AIS Class_Airspace)")
    var airspaceGeojson: String?

    @Option(name: .long, help: "OurAirports CSV directory (airports.csv, runways.csv): display names, and runway-end fallback where NASR has no surveyed coordinates. --download fetches it automatically")
    var ourairportsDir: String?

    @Option(name: .long, help: "Output path for aviation.sqlite")
    var output: String = "aviation.sqlite"

    func run() throws {
        print("NASR Importer - OpenEFB Aviation Database Generator")
        print("Output: \(output)")

        var csvDir = nasrDir
        var geojsonPath = airspaceGeojson
        var oaDir = ourairportsDir

        if download {
            let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("nasr-\(UUID().uuidString)")
            try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
            let effective = try cycle.map { try parseISODate($0) } ?? NASRCycle.current(on: Date()).effective
            let downloaded = try runBlocking { try await downloadNASR(cycleEffective: effective, into: tmp) }
            csvDir = downloaded.csvDir
            geojsonPath = downloaded.geojsonPath
            oaDir = oaDir ?? downloaded.ourAirportsDir
        }

        guard let csvDir else {
            throw ValidationError("Provide --download or --nasr-dir <path>")
        }

        try generateDatabase(
            csvDir: csvDir,
            airspaceGeoJSON: geojsonPath,
            ourAirportsDir: oaDir,
            outputPath: output
        )
        print("Done!")
    }
}

func runBlocking<T>(_ body: @escaping () async throws -> T) throws -> T {
    let semaphore = DispatchSemaphore(value: 0)
    var result: Result<T, Error>?
    Task {
        result = await Result { try await body() }
        semaphore.signal()
    }
    semaphore.wait()
    guard let result else { throw NSError(domain: "NASRImporter", code: 2) }
    return try result.get()
}

extension Result where Failure == Error {
    init(catching body: () async throws -> Success) async {
        do { self = .success(try await body()) } catch { self = .failure(error) }
    }
}

// MARK: - NASR cycle

/// NASR publishes on a 28-day cycle (AIRAC). `anchor` is a known effective date.
struct NASRCycle {
    static let lengthDays = 28
    static let anchor = DateComponents(calendar: utcCalendar, year: 2026, month: 10, day: 29).date ?? Date()

    let effective: Date
    var expires: Date { utcCalendar.date(byAdding: .day, value: Self.lengthDays, to: effective) ?? effective }

    static func current(on date: Date) -> NASRCycle {
        let days = utcCalendar.dateComponents([.day], from: anchor, to: date).day ?? 0
        let cycles = Int((Double(days) / Double(lengthDays)).rounded(.down))
        let eff = utcCalendar.date(byAdding: .day, value: cycles * lengthDays, to: anchor) ?? anchor
        return NASRCycle(effective: eff)
    }
}

let utcCalendar: Calendar = {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "UTC") ?? .current
    return cal
}()

let isoDateFormatter: DateFormatter = {
    let f = DateFormatter()
    f.calendar = utcCalendar
    f.timeZone = utcCalendar.timeZone
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd"
    return f
}()

func parseISODate(_ s: String) throws -> Date {
    guard let d = isoDateFormatter.date(from: s) else { throw ValidationError("Bad date '\(s)', expected YYYY-MM-DD") }
    return d
}

/// NASR CSVs write dates as "2026/10/29".
func parseNASRDate(_ s: String) -> Date? {
    isoDateFormatter.date(from: s.replacingOccurrences(of: "/", with: "-"))
}

// MARK: - Download

struct DownloadResult {
    let csvDir: String
    let geojsonPath: String
    let ourAirportsDir: String
}

func downloadNASR(cycleEffective: Date, into dir: URL) async throws -> DownloadResult {
    let f = DateFormatter()
    f.calendar = utcCalendar
    f.timeZone = utcCalendar.timeZone
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "dd_MMM_yyyy"
    let stamp = f.string(from: cycleEffective)
    guard let zipURL = URL(string: "https://nfdc.faa.gov/webContent/28DaySub/extra/\(stamp)_CSV.zip") else {
        throw ValidationError("Bad cycle date")
    }
    print("Downloading \(zipURL.absoluteString)...")
    var request = URLRequest(url: zipURL)
    // nfdc.faa.gov answers 503 to curl's default user agent.
    request.setValue("Mozilla/5.0 (Macintosh) OpenEFB-nasr-importer", forHTTPHeaderField: "User-Agent")
    let (zipData, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
        throw NSError(domain: "NASRImporter", code: 1, userInfo: [NSLocalizedDescriptionKey: "NASR download failed for \(stamp)"])
    }
    let zipPath = dir.appendingPathComponent("nasr.zip")
    try zipData.write(to: zipPath)
    print("  \(zipData.count / 1024) KB")

    let csvDir = dir.appendingPathComponent("csv", isDirectory: true)
    try FileManager.default.createDirectory(at: csvDir, withIntermediateDirectories: true)
    let unzip = Process()
    unzip.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
    unzip.arguments = ["-oq", zipPath.path, "-d", csvDir.path]
    try unzip.run()
    unzip.waitUntilExit()
    guard unzip.terminationStatus == 0 else {
        throw NSError(domain: "NASRImporter", code: 1, userInfo: [NSLocalizedDescriptionKey: "unzip failed"])
    }

    let geojsonPath = dir.appendingPathComponent("class_airspace.geojson")
    try await downloadClassAirspace(to: geojsonPath)

    let oaDir = dir.appendingPathComponent("ourairports", isDirectory: true)
    try FileManager.default.createDirectory(at: oaDir, withIntermediateDirectories: true)
    for file in ["airports.csv", "runways.csv"] {
        print("Downloading OurAirports \(file)...")
        guard let url = URL(string: "https://davidmegginson.github.io/ourairports-data/\(file)") else { continue }
        let (data, _) = try await URLSession.shared.data(from: url)
        try data.write(to: oaDir.appendingPathComponent(file))
    }
    return DownloadResult(csvDir: csvDir.path, geojsonPath: geojsonPath.path, ourAirportsDir: oaDir.path)
}

/// Page through the FAA AIS Class_Airspace feature service and write one FeatureCollection.
func downloadClassAirspace(to path: URL) async throws {
    let base = "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Class_Airspace/FeatureServer/0/query"
    let fields = "OBJECTID,IDENT,ICAO_ID,NAME,UPPER_VAL,UPPER_UOM,UPPER_CODE,LOWER_VAL,LOWER_UOM,LOWER_CODE,LOCAL_TYPE,CLASS,CITY,STATE,SECTOR,MIL_CODE"
    let pageSize = 200
    var offset = 0
    var features: [Any] = []
    print("Downloading Class B/C/D airspace polygons...")
    while true {
        var comps = URLComponents(string: base)
        comps?.queryItems = [
            URLQueryItem(name: "where", value: "LOCAL_TYPE IN ('CLASS_B','CLASS_C','CLASS_D')"),
            URLQueryItem(name: "outFields", value: fields),
            URLQueryItem(name: "outSR", value: "4326"),
            URLQueryItem(name: "geometryPrecision", value: "4"),
            URLQueryItem(name: "maxAllowableOffset", value: "0.0003"),
            URLQueryItem(name: "resultOffset", value: String(offset)),
            URLQueryItem(name: "resultRecordCount", value: String(pageSize)),
            URLQueryItem(name: "f", value: "geojson"),
        ]
        guard let url = comps?.url else { throw ValidationError("Bad airspace URL") }
        let (data, _) = try await URLSession.shared.data(from: url)
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let page = obj["features"] as? [Any] else {
            throw NSError(domain: "NASRImporter", code: 1, userInfo: [NSLocalizedDescriptionKey: "Bad airspace page at offset \(offset)"])
        }
        features += page
        print("  \(features.count) features")
        if page.count < pageSize { break }
        offset += pageSize
    }
    let collection: [String: Any] = ["type": "FeatureCollection", "features": features]
    try JSONSerialization.data(withJSONObject: collection).write(to: path)
}

// MARK: - CSV Parsing

/// Parse a CSV line handling quoted fields with embedded commas.
func parseCSVLine(_ line: Substring) -> [String] {
    var fields: [String] = []
    var current = ""
    var inQuotes = false
    var i = line.startIndex

    while i < line.endIndex {
        let ch = line[i]
        if inQuotes {
            if ch == "\"" {
                let next = line.index(after: i)
                if next < line.endIndex && line[next] == "\"" {
                    current.append("\"")
                    i = line.index(after: next)
                    continue
                } else {
                    inQuotes = false
                }
            } else {
                current.append(ch)
            }
        } else {
            if ch == "\"" {
                inQuotes = true
            } else if ch == "," {
                fields.append(current)
                current = ""
            } else {
                current.append(ch)
            }
        }
        i = line.index(after: i)
    }
    fields.append(current)
    return fields
}

/// A parsed CSV table with header-name lookup.
struct CSVTable {
    let headers: [String]
    let rows: [[String]]
    private let index: [String: Int]

    init(path: String) throws {
        var content = try String(contentsOfFile: path, encoding: .utf8)
        if content.hasPrefix("\u{FEFF}") { content.removeFirst() }
        var headers: [String] = []
        var rows: [[String]] = []
        var first = true
        content.enumerateLines { line, _ in
            if line.isEmpty { return }
            let fields = parseCSVLine(Substring(line))
            if first {
                headers = fields.map { $0.trimmingCharacters(in: .whitespaces) }
                first = false
            } else {
                rows.append(fields)
            }
        }
        self.headers = headers
        self.rows = rows
        var idx: [String: Int] = [:]
        for (i, h) in headers.enumerated() where idx[h] == nil { idx[h] = i }
        self.index = idx
    }

    func column(_ name: String) throws -> Int {
        guard let i = index[name] else { throw ValidationError("Column \(name) missing; headers: \(headers)") }
        return i
    }
}

@inline(__always) func field(_ row: [String], _ i: Int) -> String {
    i < row.count ? row[i].trimmingCharacters(in: .whitespaces) : ""
}

func double(_ row: [String], _ i: Int) -> Double? { Double(field(row, i)) }
func int(_ row: [String], _ i: Int) -> Int? {
    let s = field(row, i)
    if let v = Int(s) { return v }
    if let d = Double(s) { return Int(d) }
    return nil
}

// MARK: - Code mapping (NASR vocabularies -> app enum raw values)

/// APT_BASE.SITE_TYPE_CODE -> AirportType rawValue. Balloonports have no app type and are skipped.
func mapSiteType(_ code: String) -> String? {
    switch code {
    case "A", "G": return "airport"     // airport, gliderport
    case "H": return "heliport"
    case "C": return "seaplane"
    case "U": return "ultralight"
    default: return nil                 // "B" balloonport
    }
}

/// OWNERSHIP_TYPE_CODE (PU, PR, MA air force, MN navy, MR army, CG coast guard) and
/// FACILITY_USE_CODE (PU, PR) -> OwnershipType rawValue. Private *use* is what a pilot needs
/// to know (landing needs permission), so facility use wins over who holds the deed.
func mapOwnership(ownership: String, use: String) -> String {
    switch ownership {
    case "MA", "MN", "MR", "CG": return "military"
    default: return use == "PR" ? "private" : "public"
    }
}

/// APT_RWY.SURFACE_TYPE_CODE ("ASPH", "ASPH-CONC", "TURF-GRVL", ...) -> SurfaceType rawValue.
/// Composite codes use the first (primary) component.
func mapSurface(_ code: String) -> String {
    let primary = code.uppercased()
        .split(whereSeparator: { $0 == "-" || $0 == "/" })
        .first.map(String.init) ?? ""
    switch primary {
    case "ASPH", "PEM": return "asphalt"
    case "CONC": return "concrete"
    case "TURF", "GRASS": return "turf"
    case "GRVL", "GRAVEL": return "gravel"
    case "DIRT", "CALICHE", "SAND", "TRTD": return "dirt"
    case "WATER": return "water"
    default: return "other"             // MATS, ROOF-TOP, DECK, WOOD, METAL, ...
    }
}

/// APT_RWY.RWY_LGT_CODE (HIGH, MED, LOW, NSTD, PERI, FLD, STRB, "") plus the airport's
/// LGT_SKED ("SS-SR", "DUSK-DAWN", "SEE RMK" for pilot-controlled, ...) -> LightingType rawValue.
func mapLighting(code: String, schedule: String) -> String {
    guard !code.isEmpty, code != "NONE" else { return "none" }
    let sked = schedule.uppercased()
    if sked.isEmpty || sked == "SS-SR" || sked == "DUSK-DAWN" || sked == "24" { return "fullTime" }
    return "partTime"
}

/// FRQ.FREQ_USE -> (FrequencyType rawValue, display name). Returns nil for uses pilots don't
/// tune at an airport (military ops, RCAG, DP/STAR sector names, emergency).
func mapFrequencyUse(_ use: String, facilityName: String) -> (type: String, name: String)? {
    let u = use.uppercased()
    switch u {
    case "CTAF": return ("ctaf", "CTAF")
    case "UNICOM": return ("unicom", "UNICOM")
    case "MULTICOM": return ("multicom", "MULTICOM")
    case "ATIS": return ("atis", "ATIS")
    case "D-ATIS": return ("atis", "D-ATIS")
    case "LCL/P", "LCL/S": return ("tower", "TWR")
    case "GND/P", "GND/S": return ("ground", "GND")
    case "CD/P", "CD/S", "CLNC DEL": return ("clearance", "CLNC DEL")
    case "CLASS B", "CLASS C", "TRSA": return ("approach", "\(facilityName) APP (\(u))")
    default: break
    }
    let isApproach = u.contains("APCH")
    let isDeparture = u.contains("DEP")
    if isApproach && isDeparture { return ("approach", "\(facilityName) APP/DEP") }
    if isApproach { return ("approach", "\(facilityName) APP") }
    if isDeparture { return ("departure", "\(facilityName) DEP") }
    return nil
}

/// NAV_BASE.NAV_TYPE -> NavaidType rawValue. VOTs and fan markers are not navigation fixes.
func mapNavaidType(_ type: String) -> String? {
    switch type.uppercased() {
    case "VOR": return "vor"
    case "VOR/DME": return "vor_dme"
    case "VORTAC": return "vortac"
    case "TACAN": return "tacan"
    case "DME": return "dme"
    case "NDB", "MARINE NDB": return "ndb"
    case "NDB/DME": return "ndb_dme"
    default: return nil
    }
}

/// "118.6", "112.9/76X" (freq/channel), "122.1R" -> MHz (or kHz for NDB).
func parseFrequency(_ raw: String) -> Double? {
    var digits = ""
    for ch in raw {
        if ch.isNumber || ch == "." { digits.append(ch) } else { break }
    }
    return Double(digits)
}

/// Magnetic variation: NASR gives magnitude + hemisphere ("15", "E"). App convention: W negative.
func signedVariation(_ magnitude: Double?, hemisphere: String) -> Double? {
    guard let magnitude else { return nil }
    return hemisphere.uppercased() == "W" ? -magnitude : magnitude
}

/// "PALO ALTO MUNI" -> "Palo Alto Muni". Keeps identifiers (digits, slashes) untouched.
func titleCase(_ s: String) -> String {
    s.split(separator: " ").map { word -> String in
        if word.contains(where: { $0.isNumber }) { return String(word) }
        return word.prefix(1).uppercased() + word.dropFirst().lowercased()
    }.joined(separator: " ")
}

// MARK: - Database Generation

func generateDatabase(csvDir: String, airspaceGeoJSON: String?, ourAirportsDir: String?, outputPath: String) throws {
    let fileManager = FileManager.default
    if fileManager.fileExists(atPath: outputPath) {
        try fileManager.removeItem(atPath: outputPath)
    }
    let parentDir = (outputPath as NSString).deletingLastPathComponent
    if !parentDir.isEmpty && !fileManager.fileExists(atPath: parentDir) {
        try fileManager.createDirectory(atPath: parentDir, withIntermediateDirectories: true)
    }

    let dbQueue = try DatabaseQueue(path: outputPath, configuration: Configuration())
    try createSchema(dbQueue)

    func csv(_ name: String) throws -> CSVTable {
        let path = (csvDir as NSString).appendingPathComponent(name)
        print("Parsing \(name)...")
        return try CSVTable(path: path)
    }

    // MARK: Optional OurAirports display names

    var ourAirportsNames: [String: String] = [:]   // ident / gps_code / local_code -> name
    struct OARunwayEnds { let leLat: Double, leLon: Double, heLat: Double, heLon: Double }
    var ourAirportsRunwayEnds: [String: OARunwayEnds] = [:]   // "<airport key>|<le>/<he>" -> ends
    if let dir = ourAirportsDir {
        let oa = try CSVTable(path: (dir as NSString).appendingPathComponent("airports.csv"))
        let oaID = try oa.column("id")
        let ident = try oa.column("ident"), gps = try oa.column("gps_code"), local = try oa.column("local_code")
        let name = try oa.column("name"), country = try oa.column("iso_country")
        var keysByOAID: [String: [String]] = [:]
        for row in oa.rows where field(row, country) == "US" {
            let n = field(row, name)
            let keys = [field(row, ident), field(row, gps), field(row, local)].filter { !$0.isEmpty }
            keysByOAID[field(row, oaID)] = keys
            for key in keys where ourAirportsNames[key] == nil { ourAirportsNames[key] = n }
        }
        print("OurAirports names loaded: \(ourAirportsNames.count) keys")

        let oaRwy = try CSVTable(path: (dir as NSString).appendingPathComponent("runways.csv"))
        let ref = try oaRwy.column("airport_ref"), leIdent = try oaRwy.column("le_ident"), heIdent = try oaRwy.column("he_ident")
        let leLat = try oaRwy.column("le_latitude_deg"), leLon = try oaRwy.column("le_longitude_deg")
        let heLat = try oaRwy.column("he_latitude_deg"), heLon = try oaRwy.column("he_longitude_deg")
        for row in oaRwy.rows {
            guard let keys = keysByOAID[field(row, ref)],
                  let a = double(row, leLat), let b = double(row, leLon),
                  let c = double(row, heLat), let d = double(row, heLon) else { continue }
            let pair = "\(field(row, leIdent))/\(field(row, heIdent))"
            for key in keys { ourAirportsRunwayEnds["\(key)|\(pair)"] = OARunwayEnds(leLat: a, leLon: b, heLat: c, heLon: d) }
        }
        print("OurAirports runway ends loaded: \(ourAirportsRunwayEnds.count) keys")
    }
    var faaIDByICAO: [String: String] = [:]

    // MARK: Airports (APT_BASE)

    let apt = try csv("APT_BASE.csv")
    let aEff = try apt.column("EFF_DATE")
    let aSite = try apt.column("SITE_NO")
    let aSiteType = try apt.column("SITE_TYPE_CODE")
    let aArptID = try apt.column("ARPT_ID")
    let aIcao = try apt.column("ICAO_ID")
    let aName = try apt.column("ARPT_NAME")
    let aOwner = try apt.column("OWNERSHIP_TYPE_CODE")
    let aUse = try apt.column("FACILITY_USE_CODE")
    let aLat = try apt.column("LAT_DECIMAL")
    let aLon = try apt.column("LONG_DECIMAL")
    let aElev = try apt.column("ELEV")
    let aMagVar = try apt.column("MAG_VARN")
    let aMagHemis = try apt.column("MAG_HEMIS")
    let aTPA = try apt.column("TPA")
    let aArtcc = try apt.column("RESP_ARTCC_ID")
    let aFss = try apt.column("FSS_ID")
    let aStatus = try apt.column("ARPT_STATUS")
    let aFuel = try apt.column("FUEL_TYPES")
    let aLgtSked = try apt.column("LGT_SKED")
    let aBeacon = try apt.column("BCN_LENS_COLOR")

    guard let firstRow = apt.rows.first, let effectiveDate = parseNASRDate(field(firstRow, aEff)) else {
        throw ValidationError("APT_BASE.csv has no EFF_DATE")
    }
    let nasrCycle = NASRCycle(effective: effectiveDate)
    print("NASR cycle effective \(isoDateFormatter.string(from: nasrCycle.effective)), expires \(isoDateFormatter.string(from: nasrCycle.expires))")

    var siteToICAO: [String: String] = [:]      // SITE_NO -> primary key
    var arptIDToICAO: [String: String] = [:]    // FAA LID -> primary key
    var lightingSchedule: [String: String] = [:] // SITE_NO -> LGT_SKED
    var airportCount = 0
    var ownershipCounts: [String: Int] = [:]

    try dbQueue.write { db in
        for row in apt.rows {
            guard field(row, aStatus) == "O" else { continue }           // skip closed (CI/CP)
            guard let dbType = mapSiteType(field(row, aSiteType)) else { continue }
            let arptID = field(row, aArptID)
            guard !arptID.isEmpty,
                  let lat = double(row, aLat), let lon = double(row, aLon) else { continue }

            let icaoID = field(row, aIcao)
            let key = icaoID.isEmpty ? arptID : icaoID
            let site = field(row, aSite)
            let ownership = mapOwnership(ownership: field(row, aOwner), use: field(row, aUse))
            let magVar = signedVariation(double(row, aMagVar), hemisphere: field(row, aMagHemis))
            let tpa = int(row, aTPA)                                        // feet AGL
            let fuel = field(row, aFuel).split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            let fuelJSON = String(data: try JSONSerialization.data(withJSONObject: fuel), encoding: .utf8) ?? "[]"
            let beacon = field(row, aBeacon).isEmpty ? 0 : 1
            let rawName = field(row, aName)
            let name = ourAirportsNames[key] ?? ourAirportsNames[arptID] ?? titleCase(rawName)
            let artcc = field(row, aArtcc)
            let fss = field(row, aFss)

            try db.execute(
                sql: """
                    INSERT OR IGNORE INTO airports (icao, faa_id, name, latitude, longitude, elevation, type, ownership, ctaf_frequency, unicom_frequency, artcc_id, fss_id, magnetic_variation, pattern_altitude, fuel_types, has_beacon_light)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)
                    """,
                arguments: [
                    key, arptID, name, lat, lon, double(row, aElev) ?? 0,
                    dbType, ownership,
                    artcc.isEmpty ? nil : artcc, fss.isEmpty ? nil : fss,
                    magVar, tpa, fuelJSON, beacon
                ]
            )
            guard db.changesCount == 1 else { continue }
            siteToICAO[site] = key
            if arptIDToICAO[arptID] == nil { arptIDToICAO[arptID] = key }
            faaIDByICAO[key] = arptID
            lightingSchedule[site] = field(row, aLgtSked)
            ownershipCounts[ownership, default: 0] += 1
            airportCount += 1
        }
    }
    print("Airports inserted: \(airportCount) \(ownershipCounts)")

    // MARK: Runway ends (APT_RWY_END) then runways (APT_RWY)

    struct RunwayEnd {
        let lat: Double?, lon: Double?, elev: Double?      // degrees, degrees, feet MSL
        let dispLat: Double?, dispLon: Double?, dispLen: Int?   // displaced threshold
    }
    let ends = try csv("APT_RWY_END.csv")
    let eSite = try ends.column("SITE_NO"), eRwy = try ends.column("RWY_ID"), eEnd = try ends.column("RWY_END_ID")
    let eLat = try ends.column("LAT_DECIMAL"), eLon = try ends.column("LONG_DECIMAL"), eElev = try ends.column("RWY_END_ELEV")
    let eDLat = try ends.column("LAT_DISPLACED_THR_DECIMAL"), eDLon = try ends.column("LONG_DISPLACED_THR_DECIMAL")
    let eDLen = try ends.column("DISPLACED_THR_LEN")
    var runwayEnds: [String: RunwayEnd] = [:]   // "SITE|RWY|END"
    for row in ends.rows {
        let k = "\(field(row, eSite))|\(field(row, eRwy))|\(field(row, eEnd))"
        runwayEnds[k] = RunwayEnd(
            lat: double(row, eLat), lon: double(row, eLon), elev: double(row, eElev),
            dispLat: double(row, eDLat), dispLon: double(row, eDLon), dispLen: int(row, eDLen)
        )
    }

    let rwy = try csv("APT_RWY.csv")
    let rSite = try rwy.column("SITE_NO"), rID = try rwy.column("RWY_ID")
    let rLen = try rwy.column("RWY_LEN"), rWid = try rwy.column("RWY_WIDTH")
    let rSurf = try rwy.column("SURFACE_TYPE_CODE"), rLgt = try rwy.column("RWY_LGT_CODE")
    var runwayCount = 0
    var endsWithCoordinates = 0
    var endsFromOurAirports = 0

    try dbQueue.write { db in
        for row in rwy.rows {
            let site = field(row, rSite)
            guard let icao = siteToICAO[site] else { continue }
            let rwyID = field(row, rID)
            guard !rwyID.isEmpty, let length = int(row, rLen), length > 0 else { continue }
            let parts = rwyID.split(separator: "/").map(String.init)
            let baseID = parts.first ?? rwyID
            let recipID = parts.count > 1 ? parts[1] : baseID
            let base = runwayEnds["\(site)|\(rwyID)|\(baseID)"]
            let recip = runwayEnds["\(site)|\(rwyID)|\(recipID)"]
            var ends = (base?.lat, base?.lon, recip?.lat, recip?.lon)
            if base?.lat == nil || recip?.lat == nil {
                // NASR has no surveyed coordinates for (one of) the ends: take a consistent pair
                // from OurAirports rather than mixing sources or leaving 0,0.
                let keys = [icao, faaIDByICAO[icao] ?? ""]
                for k in keys where !k.isEmpty {
                    if let oa = ourAirportsRunwayEnds["\(k)|\(baseID)/\(recipID)"] {
                        ends = (oa.leLat, oa.leLon, oa.heLat, oa.heLon)
                        break
                    }
                    if let oa = ourAirportsRunwayEnds["\(k)|\(recipID)/\(baseID)"] {
                        ends = (oa.heLat, oa.heLon, oa.leLat, oa.leLon)
                        break
                    }
                }
                if ends.0 != base?.lat { endsFromOurAirports += 1 }
            } else {
                endsWithCoordinates += 1
            }

            try db.execute(
                sql: """
                    INSERT INTO runways (id, airport_icao, length, width, surface, lighting,
                        base_end_id, reciprocal_end_id,
                        base_end_latitude, base_end_longitude, reciprocal_end_latitude, reciprocal_end_longitude,
                        base_end_elevation, reciprocal_end_elevation,
                        base_displaced_threshold_latitude, base_displaced_threshold_longitude, base_displaced_threshold_length,
                        reciprocal_displaced_threshold_latitude, reciprocal_displaced_threshold_longitude, reciprocal_displaced_threshold_length)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                arguments: [
                    rwyID, icao, length, int(row, rWid) ?? 0,
                    mapSurface(field(row, rSurf)),
                    mapLighting(code: field(row, rLgt), schedule: lightingSchedule[site] ?? ""),
                    baseID, recipID,
                    ends.0 ?? 0, ends.1 ?? 0, ends.2 ?? 0, ends.3 ?? 0,
                    base?.elev, recip?.elev,
                    base?.dispLat, base?.dispLon, base?.dispLen,
                    recip?.dispLat, recip?.dispLon, recip?.dispLen
                ]
            )
            runwayCount += 1
        }
    }
    print("Runways inserted: \(runwayCount) (\(endsWithCoordinates) with NASR end coordinates, \(endsFromOurAirports) from OurAirports fallback)")

    // MARK: Frequencies (FRQ + AWOS)

    // AWOS/ASOS frequencies are serviced by the weather station id; AWOS.csv maps that to the airport site.
    var awosToSite: [String: String] = [:]
    if fileManager.fileExists(atPath: (csvDir as NSString).appendingPathComponent("AWOS.csv")) {
        let awos = try csv("AWOS.csv")
        let wID = try awos.column("ASOS_AWOS_ID"), wSite = try awos.column("SITE_NO")
        for row in awos.rows where !field(row, wSite).isEmpty {
            awosToSite[field(row, wID)] = field(row, wSite)
        }
    }

    let frq = try csv("FRQ.csv")
    let fFacName = try frq.column("FAC_NAME")
    let fServiced = try frq.column("SERVICED_FACILITY"), fServicedType = try frq.column("SERVICED_SITE_TYPE")
    let fFreq = try frq.column("FREQ"), fUse = try frq.column("FREQ_USE"), fSector = try frq.column("SECTORIZATION")
    let airportSiteTypes: Set<String> = ["AIRPORT", "HELIPORT", "SEAPLANE BASE", "ULTRALIGHT", "GLIDERPORT"]
    var frequencyCount = 0
    var airportCTAF: [String: Double] = [:]
    var airportUNICOM: [String: Double] = [:]
    var seen = Set<String>()

    try dbQueue.write { db in
        for row in frq.rows {
            guard let mhz = parseFrequency(field(row, fFreq)), mhz >= 108, mhz < 137 else { continue } // VHF comm/nav band only
            let servicedType = field(row, fServicedType)
            let serviced = field(row, fServiced)
            let use = field(row, fUse)
            let icao: String
            let mapped: (type: String, name: String)
            if servicedType.hasPrefix("AWOS") || servicedType.hasPrefix("ASOS") {
                guard let site = awosToSite[serviced], let key = siteToICAO[site] else { continue }
                icao = key
                mapped = (servicedType.hasPrefix("ASOS") ? "asos" : "awos", servicedType)
            } else {
                guard airportSiteTypes.contains(servicedType), let key = arptIDToICAO[serviced] else { continue }
                guard let m = mapFrequencyUse(use, facilityName: field(row, fFacName)) else { continue }
                icao = key
                let sector = field(row, fSector)
                mapped = sector.isEmpty ? m : (m.type, "\(m.name) \(sector)")
            }
            let dedupe = "\(icao)|\(mapped.type)|\(mapped.name)|\(mhz)"
            guard seen.insert(dedupe).inserted else { continue }

            try db.execute(
                sql: "INSERT INTO frequencies (id, airport_icao, type, name, frequency) VALUES (?, ?, ?, ?, ?)",
                arguments: [UUID().uuidString, icao, mapped.type, mapped.name, mhz]
            )
            frequencyCount += 1
            if mapped.type == "ctaf" { airportCTAF[icao] = mhz }
            if mapped.type == "unicom" { airportUNICOM[icao] = mhz }
        }
        for (icao, ctaf) in airportCTAF {
            try db.execute(sql: "UPDATE airports SET ctaf_frequency = ? WHERE icao = ?", arguments: [ctaf, icao])
        }
        for (icao, unicom) in airportUNICOM {
            try db.execute(sql: "UPDATE airports SET unicom_frequency = ? WHERE icao = ?", arguments: [unicom, icao])
        }
    }
    print("Frequencies inserted: \(frequencyCount); CTAF on \(airportCTAF.count), UNICOM on \(airportUNICOM.count) airports")

    // MARK: Navaids (NAV_BASE)

    let nav = try csv("NAV_BASE.csv")
    let nID = try nav.column("NAV_ID"), nType = try nav.column("NAV_TYPE"), nName = try nav.column("NAME")
    let nStatus = try nav.column("NAV_STATUS")
    let nLat = try nav.column("LAT_DECIMAL"), nLon = try nav.column("LONG_DECIMAL"), nElev = try nav.column("ELEV")
    let nMagVar = try nav.column("MAG_VARN"), nMagHemis = try nav.column("MAG_VARN_HEMIS"), nFreq = try nav.column("FREQ")
    var navaidCount = 0

    // VHF navaids first so an NDB sharing an ident loses the primary-key conflict, not the VOR.
    let navRows = nav.rows.sorted { field($0, nType).hasPrefix("NDB") == false && field($1, nType).hasPrefix("NDB") }
    try dbQueue.write { db in
        for row in navRows {
            guard let mappedType = mapNavaidType(field(row, nType)) else { continue }
            guard field(row, nStatus).uppercased().hasPrefix("OPERATIONAL") else { continue }
            let ident = field(row, nID)
            guard !ident.isEmpty, let lat = double(row, nLat), let lon = double(row, nLon) else { continue }
            let freq = parseFrequency(field(row, nFreq)) ?? 0     // MHz for VHF, kHz for NDB
            try db.execute(
                sql: """
                    INSERT OR IGNORE INTO navaids (id, type, name, latitude, longitude, frequency, elevation, magnetic_variation)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                arguments: [
                    ident, mappedType, titleCase(field(row, nName)), lat, lon, freq,
                    double(row, nElev), signedVariation(double(row, nMagVar), hemisphere: field(row, nMagHemis))
                ]
            )
            if db.changesCount == 1 { navaidCount += 1 }
        }
    }
    print("Navaids inserted: \(navaidCount)")

    // MARK: Airspace polygons (FAA AIS Class_Airspace GeoJSON)

    var airspaceCount = 0
    var airspaceSource = "none"
    if let geojsonPath = airspaceGeoJSON {
        print("Importing airspace polygons from \(geojsonPath)...")
        airspaceSource = "FAA AIS Class_Airspace feature service (services6.arcgis.com), Class B/C/D"
        airspaceCount = try importAirspace(geojsonPath: geojsonPath, into: dbQueue)
    } else {
        print("WARNING: no --airspace-geojson given; airspaces table will be empty")
    }
    print("Airspaces inserted: \(airspaceCount)")

    // MARK: Metadata

    let generatedAt = ISO8601DateFormatter().string(from: Date())
    try dbQueue.write { db in
        let rows: [(String, String)] = [
            ("schema_version", "2"),
            ("source", "FAA NASR 28-day subscription CSV"),
            ("nasr_cycle", isoDateFormatter.string(from: nasrCycle.effective)),
            ("nasr_effective", isoDateFormatter.string(from: nasrCycle.effective)),
            ("nasr_expires", isoDateFormatter.string(from: nasrCycle.expires)),
            ("airspace_source", airspaceSource),
            ("generated_at", generatedAt),
        ]
        for (k, v) in rows {
            try db.execute(sql: "INSERT INTO metadata (key, value) VALUES (?, ?)", arguments: [k, v])
        }
    }

    // MARK: Indexes and finalize

    print("Building R-tree and FTS5 indexes...")
    try dbQueue.write { db in
        try db.execute(sql: "INSERT INTO airports_rtree (rowid, min_lat, max_lat, min_lon, max_lon) SELECT rowid, latitude, latitude, longitude, longitude FROM airports")
        try db.execute(sql: "INSERT INTO navaids_rtree (rowid, min_lat, max_lat, min_lon, max_lon) SELECT rowid, latitude, latitude, longitude, longitude FROM navaids")
        try db.execute(sql: "INSERT INTO airspaces_rtree (rowid, min_lat, max_lat, min_lon, max_lon) SELECT rowid, min_lat, max_lat, min_lon, max_lon FROM airspaces")
        try db.execute(sql: "INSERT INTO airports_fts (rowid, icao, name, faa_id) SELECT rowid, icao, name, COALESCE(faa_id, '') FROM airports")
        try db.execute(sql: "PRAGMA journal_mode=DELETE")
    }
    try dbQueue.writeWithoutTransaction { db in
        try db.execute(sql: "VACUUM")
    }

    try dbQueue.read { db in
        func count(_ table: String) throws -> Int { try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM \(table)") ?? 0 }
        print("")
        print("=== Aviation Database Summary ===")
        print("Airports:    \(try count("airports"))")
        print("Runways:     \(try count("runways"))")
        print("Frequencies: \(try count("frequencies"))")
        print("Navaids:     \(try count("navaids"))")
        print("Airspaces:   \(try count("airspaces"))")
        print("R-tree airports: \(try count("airports_rtree"))")
        print("FTS5 entries:    \(try count("airports_fts"))")
        print("Output: \(outputPath)")
        print("=================================")
    }
    let fileSize = try fileManager.attributesOfItem(atPath: outputPath)[.size] as? Int ?? 0
    print("File size: \(fileSize / 1024) KB (\(fileSize / (1024 * 1024)) MB)")
}

// MARK: - Schema

func createSchema(_ dbQueue: DatabaseQueue) throws {
    try dbQueue.write { db in
        try db.execute(sql: """
            CREATE TABLE metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """)
        try db.execute(sql: """
            CREATE TABLE airports (
                icao TEXT PRIMARY KEY,
                faa_id TEXT,
                name TEXT NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                elevation REAL NOT NULL DEFAULT 0,
                type TEXT NOT NULL DEFAULT 'airport',
                ownership TEXT NOT NULL DEFAULT 'public',
                ctaf_frequency REAL,
                unicom_frequency REAL,
                artcc_id TEXT,
                fss_id TEXT,
                magnetic_variation REAL,
                pattern_altitude INTEGER,
                fuel_types TEXT DEFAULT '[]',
                has_beacon_light INTEGER DEFAULT 0
            )
            """)
        try db.execute(sql: """
            CREATE TABLE runways (
                id TEXT NOT NULL,
                airport_icao TEXT NOT NULL REFERENCES airports(icao),
                length INTEGER NOT NULL,
                width INTEGER NOT NULL,
                surface TEXT NOT NULL DEFAULT 'asphalt',
                lighting TEXT NOT NULL DEFAULT 'none',
                base_end_id TEXT NOT NULL,
                reciprocal_end_id TEXT NOT NULL,
                base_end_latitude REAL NOT NULL DEFAULT 0,
                base_end_longitude REAL NOT NULL DEFAULT 0,
                reciprocal_end_latitude REAL NOT NULL DEFAULT 0,
                reciprocal_end_longitude REAL NOT NULL DEFAULT 0,
                base_end_elevation REAL,
                reciprocal_end_elevation REAL,
                base_displaced_threshold_latitude REAL,
                base_displaced_threshold_longitude REAL,
                base_displaced_threshold_length INTEGER,
                reciprocal_displaced_threshold_latitude REAL,
                reciprocal_displaced_threshold_longitude REAL,
                reciprocal_displaced_threshold_length INTEGER
            )
            """)
        try db.execute(sql: """
            CREATE TABLE frequencies (
                id TEXT NOT NULL,
                airport_icao TEXT NOT NULL REFERENCES airports(icao),
                type TEXT NOT NULL,
                name TEXT NOT NULL,
                frequency REAL NOT NULL
            )
            """)
        try db.execute(sql: """
            CREATE TABLE navaids (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL DEFAULT 'vor',
                name TEXT NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                frequency REAL NOT NULL DEFAULT 0,
                elevation REAL,
                magnetic_variation REAL
            )
            """)
        try db.execute(sql: """
            CREATE TABLE airspaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                class TEXT NOT NULL,
                floor_altitude INTEGER NOT NULL DEFAULT 0,
                ceiling_altitude INTEGER NOT NULL DEFAULT 18000,
                center_latitude REAL,
                center_longitude REAL,
                radius_nm REAL,
                coordinates TEXT,
                min_lat REAL NOT NULL,
                max_lat REAL NOT NULL,
                min_lon REAL NOT NULL,
                max_lon REAL NOT NULL
            )
            """)
        try db.execute(sql: "CREATE VIRTUAL TABLE airports_rtree USING rtree(rowid, min_lat, max_lat, min_lon, max_lon)")
        try db.execute(sql: "CREATE VIRTUAL TABLE navaids_rtree USING rtree(rowid, min_lat, max_lat, min_lon, max_lon)")
        try db.execute(sql: "CREATE VIRTUAL TABLE airspaces_rtree USING rtree(rowid, min_lat, max_lat, min_lon, max_lon)")
        try db.execute(sql: "CREATE VIRTUAL TABLE airports_fts USING fts5(icao, name, faa_id, content=airports, content_rowid=rowid)")
        try db.execute(sql: "CREATE INDEX idx_runways_airport ON runways(airport_icao)")
        try db.execute(sql: "CREATE INDEX idx_frequencies_airport ON frequencies(airport_icao)")
        print("Schema created successfully.")
    }
}

// MARK: - Airspace import

/// One row per outer ring. Class B/C shelves are separate features in the FAA data (one per
/// floor), so a "wedding cake" becomes several rows with the same name and different floors.
/// Holes (the inner edge of a shelf) are dropped: the app renders single rings only.
func importAirspace(geojsonPath: String, into dbQueue: DatabaseQueue) throws -> Int {
    let data = try Data(contentsOf: URL(fileURLWithPath: geojsonPath))
    guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let features = obj["features"] as? [[String: Any]] else {
        throw ValidationError("\(geojsonPath) is not a GeoJSON FeatureCollection")
    }

    func altitude(_ props: [String: Any], _ valueKey: String, _ codeKey: String, _ uomKey: String) -> Int? {
        guard let v = props[valueKey] as? Double else { return nil }
        let code = (props[codeKey] as? String ?? "").uppercased()
        let uom = (props[uomKey] as? String ?? "FT").uppercased()
        if code == "SFC" { return 0 }
        if uom == "FL" { return Int(v) * 100 }
        return Int(v)                                   // feet (MSL; AGL floors are rare for B/C/D)
    }

    var count = 0
    try dbQueue.write { db in
        for feature in features {
            guard let props = feature["properties"] as? [String: Any],
                  let geometry = feature["geometry"] as? [String: Any],
                  let geomType = geometry["type"] as? String else { continue }
            let cls: String
            switch (props["CLASS"] as? String ?? "").uppercased() {
            case "B": cls = "bravo"
            case "C": cls = "charlie"
            case "D": cls = "delta"
            default: continue
            }
            let objectID = (props["OBJECTID"] as? Int).map(String.init) ?? UUID().uuidString
            let ident = props["IDENT"] as? String ?? props["ICAO_ID"] as? String ?? "AIRSPACE"
            var name = props["NAME"] as? String ?? "\(ident) Class \(cls)"
            if let sector = props["SECTOR"] as? String, !sector.isEmpty { name += " \(sector)" }
            let floor = altitude(props, "LOWER_VAL", "LOWER_CODE", "LOWER_UOM") ?? 0
            let ceiling = altitude(props, "UPPER_VAL", "UPPER_CODE", "UPPER_UOM") ?? 18000

            // GeoJSON: Polygon = [ring...], MultiPolygon = [[ring...]...]; ring = [[lon, lat]...]
            var outerRings: [[[Double]]] = []
            if geomType == "Polygon", let rings = geometry["coordinates"] as? [[[Double]]], let outer = rings.first {
                outerRings = [outer]
            } else if geomType == "MultiPolygon", let polys = geometry["coordinates"] as? [[[[Double]]]] {
                outerRings = polys.compactMap { $0.first }
            }

            for (i, ring) in outerRings.enumerated() {
                let latLon = ring.compactMap { pair -> [Double]? in
                    guard pair.count >= 2 else { return nil }
                    return [pair[1], pair[0]]
                }
                guard latLon.count >= 3 else { continue }
                let lats = latLon.map { $0[0] }, lons = latLon.map { $0[1] }
                guard let minLat = lats.min(), let maxLat = lats.max(), let minLon = lons.min(), let maxLon = lons.max() else { continue }
                let coordsJSON = String(data: try JSONSerialization.data(withJSONObject: latLon), encoding: .utf8) ?? "[]"
                let id = outerRings.count > 1 ? "\(ident)-\(cls)-\(objectID)-\(i)" : "\(ident)-\(cls)-\(objectID)"
                try db.execute(
                    sql: """
                        INSERT INTO airspaces (id, name, class, floor_altitude, ceiling_altitude, center_latitude, center_longitude, radius_nm, coordinates, min_lat, max_lat, min_lon, max_lon)
                        VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?)
                        """,
                    arguments: [id, name, cls, floor, ceiling, coordsJSON, minLat, maxLat, minLon, maxLon]
                )
                count += 1
            }
        }
    }
    return count
}
