//
//  DesignTokens.swift
//  efb-212
//
//  Spacing, radii, type roles, semantic colors and strip metrics (docs/DESIGN.md `## Tokens`).
//  Direction 2, "the log and the leading edge": the strip and the log stack are set in the bundled
//  Archivo (idents, readouts, labels) and IBM Plex Mono (times, distances, frequencies) faces, with
//  IBM Plex Sans Hebrew as the cascade fallback so Hebrew text renders in Plex, not SF.
//  Strip colors are paper and ink: a light paper by day, near-black by night with warm ink.
//  EFB rule: red = warning, amber = caution, nothing else.
//

import SwiftUI

// MARK: - Spacing

/// 4-point spacing scale. Spacing between groups must exceed spacing within a group.
/// Plain constants, so drawing code (Canvas layout helpers) can read them off the main actor.
nonisolated enum Space {
    static let xs: CGFloat = 4      // icon + label, tight coupling
    static let s: CGFloat = 8       // related rows
    static let m: CGFloat = 12      // control padding
    static let l: CGFloat = 16      // section edge padding
    static let xl: CGFloat = 24     // between sections
    static let xxl: CGFloat = 32    // major breaks
}

// MARK: - Corner radius

/// Corner radius scale. Tags and chips use `xs`, rows and notices `s`, controls and inline cards `m`,
/// panels and floating chrome `l`. Never a literal radius in a view.
enum Radius {
    static let xs: CGFloat = 4      // PVT / MIL / PPR tags, stop square
    static let s: CGFloat = 8       // rows, banners, quiet fills
    static let m: CGFloat = 10      // map controls, inline cards
    static let l: CGFloat = 14      // panels: instrument strip, layer panel, NRST box, primary buttons
}

// MARK: - Type roles

/// Bundled faces by PostScript name (registered in Info.plist `UIAppFonts`). The only place font names appear.
private enum Face: String {
    case archivoRegular = "ArchivoRoman-Regular"
    case archivoMedium = "ArchivoRoman-Medium"
    case archivoSemiBold = "ArchivoRoman-SemiBold"
    case archivoCondensedSemiBold = "ArchivoRoman-CondensedSemiBold"
    case archivoExtraCondensedSemiBold = "ArchivoRoman-ExtraCondensedSemiBold"
    case archivoExtraCondensedBold = "ArchivoRoman-ExtraCondensedBold"
    case plexMonoRegular = "IBMPlexMono-Regular"
    case plexMonoMedium = "IBMPlexMono-Medium"
    case plexMonoSemiBold = "IBMPlexMono-SemiBold"

    /// Weight used for the Hebrew cascade face and for the system fallback.
    var weight: UIFont.Weight {
        switch self {
        case .archivoRegular, .plexMonoRegular: .regular
        case .archivoMedium, .plexMonoMedium: .medium
        case .archivoSemiBold, .archivoCondensedSemiBold, .archivoExtraCondensedSemiBold, .plexMonoSemiBold: .semibold
        case .archivoExtraCondensedBold: .bold
        }
    }

    /// IBM Plex Sans Hebrew at the nearest weight (Plex Hebrew stops at SemiBold).
    var hebrewName: String {
        switch weight {
        case .regular: "IBMPlexSansHebrew-Regular"
        case .medium: "IBMPlexSansHebrew-Medium"
        default: "IBMPlexSansHebrew-SemiBold"
        }
    }

    /// The face at `size` points, scaled for Dynamic Type relative to `style` (nil: fixed size), never past
    /// `maxSize`. Hebrew glyphs cascade to Plex Sans Hebrew. If the face is not registered (unit-test host),
    /// the system font at the same size and weight.
    func font(size: CGFloat, relativeTo style: UIFont.TextStyle?, maxSize: CGFloat? = nil) -> Font {
        let base: UIFont
        if let face = UIFont(name: rawValue, size: size) {
            let hebrew = UIFontDescriptor(name: hebrewName, size: size)
            base = UIFont(descriptor: face.fontDescriptor.addingAttributes([.cascadeList: [hebrew]]), size: size)
        } else {
            base = UIFont.systemFont(ofSize: size, weight: weight)
        }
        guard let style else { return Font(base as CTFont) }
        let metrics = UIFontMetrics(forTextStyle: style)
        let scaled = maxSize.map { metrics.scaledFont(for: base, maximumPointSize: $0) } ?? metrics.scaledFont(for: base)
        return Font(scaled as CTFont)
    }
}

/// Type roles on the bundled faces, sized from the Dynamic Type text style named beside each (base sizes are
/// the style's default size). Values are emphasized over labels: a label is small and secondary, the value it
/// describes is larger and primary. Archivo Condensed for idents and names, Archivo ExtraCondensed with
/// tabular digits for readouts and times-to, IBM Plex Mono for data read up close.
/// Computed so a Dynamic Type change applies on the next render.
enum TypeRole {
    /// Airport identifier / sheet title. largeTitle.
    static var title: Font { Face.archivoCondensedSemiBold.font(size: 34, relativeTo: .largeTitle) }
    /// Compact identifier next to a distance, e.g. "KPAO" in a nearest row. title3.
    static var identifier: Font { Face.archivoCondensedSemiBold.font(size: 20, relativeTo: .title3) }
    /// Section heading, e.g. "FREQUENCIES". caption.
    static var sectionHeader: Font { Face.archivoSemiBold.font(size: 12, relativeTo: .caption1) }
    /// Instrument readout digits at an exact point size (the caller scales it with `@ScaledMetric`).
    static func readout(size: CGFloat) -> Font {
        Face.archivoExtraCondensedSemiBold.font(size: size, relativeTo: nil).monospacedDigit()
    }
    /// Field label, e.g. "Wind", "TWR". Always paired with `Palette.secondaryText`. footnote.
    static var label: Font { Face.archivoMedium.font(size: 13, relativeTo: .footnote) }
    /// Primary value: frequency, runway ident, decoded weather. title3.
    static var value: Font { Face.plexMonoSemiBold.font(size: 20, relativeTo: .title3) }
    /// Secondary value: smaller readout next to a primary one. callout.
    static var valueSmall: Font { Face.plexMonoMedium.font(size: 16, relativeTo: .callout) }
    /// Body text. subheadline.
    static var body: Font { Face.archivoRegular.font(size: 15, relativeTo: .subheadline) }
    /// Footnotes, source and validity lines. footnote.
    static var caption: Font { Face.archivoRegular.font(size: 13, relativeTo: .footnote) }

    // Direction 2 strip and log stack roles.

    /// The next thing's time-to, the biggest type on screen: 100 pt relative to largeTitle, capped at 120 pt.
    static var nextTime: Font {
        Face.archivoExtraCondensedBold.font(size: 100, relativeTo: .largeTitle, maxSize: 120).monospacedDigit()
    }
    /// Later rows' time-to: 44 pt relative to title1, capped at 64 pt so a row fits the 400 pt strip.
    static var rowTime: Font {
        Face.archivoExtraCondensedSemiBold.font(size: 44, relativeTo: .title1, maxSize: 64).monospacedDigit()
    }
    /// Waypoint and airport idents in rows. 28 pt relative to title1.
    static var rowIdent: Font { Face.archivoCondensedSemiBold.font(size: 28, relativeTo: .title1) }
    /// Strip labels ("NEXT", "GS"). Callers apply `.textCase(.uppercase)` and
    /// `.tracking(StripMetrics.labelTracking)`. caption2.
    static var stripLabel: Font { Face.archivoMedium.font(size: 11, relativeTo: .caption2) }
    /// Times, distances, frequencies in the strip and log. subheadline.
    static var data: Font { Face.plexMonoRegular.font(size: 15, relativeTo: .subheadline) }
    /// Emphasized data, e.g. the ETA beside the next time-to. subheadline.
    static var dataEmphasis: Font { Face.plexMonoSemiBold.font(size: 15, relativeTo: .subheadline) }
}

// MARK: - Strip metrics

/// Fixed geometry of the leading-edge strip (iPad) and rail (iPhone).
enum StripMetrics {
    /// iPad strip width, fixed (owner decision Q3 A).
    static let width: CGFloat = 400
    /// iPhone rail width.
    static let railWidth: CGFloat = 104
    /// Minimum in-flight tap target and footer cell height.
    static let cell: CGFloat = 60
    /// Letter spacing for uppercase `TypeRole.stripLabel` text.
    static let labelTracking: CGFloat = 1.2
}

/// Shared size for in-flight map controls (design: >= 60 pt).
enum MapControlMetrics {
    static let size: CGFloat = 60
    static let cornerRadius: CGFloat = Radius.l
}

// MARK: - Semantic colors

enum Palette {
    /// Primary text: full contrast.
    static let primaryText = Color.primary
    /// Secondary text. `.secondary` is >= 4.5:1 on the regular material; never use `.tertiary` for text.
    static let secondaryText = Color.secondary
    /// Caution (amber): old data, expired chart cycle. Used as text, so it must clear 4.5:1.
    /// Day #A55200 on the light material (#F2F2F7): 4.9:1. Night systemOrange on #1C1C1E: 8.3:1.
    static let caution = Color(UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? .systemOrange
            : UIColor(red: 0.647, green: 0.322, blue: 0, alpha: 1)
    })
    /// Warning (red): closures, urgent PIREPs, lost GPS. Used as text, so it must clear 4.5:1.
    /// Day #C80014 on the light material: 5.4:1. Night systemRed on #1C1C1E: 5.0:1.
    static let warning = Color(UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? .systemRed
            : UIColor(red: 0.784, green: 0, blue: 0.078, alpha: 1)
    })
    /// Text drawn on a solid `warning` fill (closure chip). Day white on #C80014: 6.1:1;
    /// night black on systemRed: 6.2:1 (white would be 3.4:1).
    static let onWarning = Color(UIColor { trait in
        trait.userInterfaceStyle == .dark ? .black : .white
    })
    /// Success / "all good" glyphs and text (confirmed entry, GPS fix, VFR dot). Day #147832 on the light
    /// material 5.0:1; night systemGreen. Never used for anything but "fine".
    static let ok = Color(UIColor { trait in
        trait.userInterfaceStyle == .dark ? .systemGreen : UIColor(red: 0.078, green: 0.471, blue: 0.196, alpha: 1)
    })
    /// Solid amber fill for caution chips and banners (PVT/MIL/PPR tags, offline pill, route altitude
    /// caution). Always carries black text: 9:1 (white on this amber is 2.2:1). For amber *text* use `caution`.
    static let cautionFill = Color.orange
    /// North marker on the compass button. A compass convention, not a warning: the one red that is not `warning`.
    /// A light red, because it sits on the navy glass (a graphical object needs >= 3:1): day #FF9F94 on #1556B8
    /// 3.7:1 (Increase Contrast #0C4091 4.9:1); night #FF8F86 on the night glass 3.9:1. systemRed was 2.1:1 / 2.5:1.
    static let northMarker = Color(UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 1, green: 0.561, blue: 0.525, alpha: 1)
            : UIColor(red: 1, green: 0.624, blue: 0.580, alpha: 1)
    })
    /// Quiet container fill for rows and chips.
    static let fill = Color.secondary.opacity(0.12)
    /// Active route line on the map: aviation magenta (never red, which is reserved for closures and
    /// warnings). Day #D100D1 on the sectional, street and CAAI chart bases; night #F26BF2, a lighter
    /// tint that stays visible on the dimmed chart. `MapService` applies these per display mode.
    static let routeLineDay = UIColor(red: 0.82, green: 0, blue: 0.82, alpha: 1)
    static let routeLineNight = UIColor(red: 0.95, green: 0.42, blue: 0.95, alpha: 1)
    static let routeLine = Color(UIColor { trait in
        trait.userInterfaceStyle == .dark ? routeLineNight : routeLineDay
    })

    // Map layer toggle tints. A toggle track is a UI component: >= 3:1 against the panel
    // material (WCAG 1.4.11). System tints are 2.0-2.3:1 by day, so day uses darker variants of
    // the same hues; night keeps the system dark-scheme tints (all >= 4.8:1 on #1C1C1E).
    /// Sectional toggle. Day systemBlue 3.2:1 on #F2F2F7 (3.6:1 for the older #007AFF); night #4678BE 3.8:1 (`accent` night is 1.9:1).
    static let layerSectional = Color(UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 0.275, green: 0.471, blue: 0.745, alpha: 1)
            : .systemBlue
    })
    /// Airports: day #006E8C 5.2:1, night systemCyan.
    static let layerAirports = Color(UIColor { trait in
        trait.userInterfaceStyle == .dark ? .systemCyan : UIColor(red: 0, green: 0.431, blue: 0.549, alpha: 1)
    })
    /// Airspace: day #B45800 4.3:1, night systemOrange.
    static let layerAirspace = Color(UIColor { trait in
        trait.userInterfaceStyle == .dark ? .systemOrange : UIColor(red: 0.706, green: 0.345, blue: 0, alpha: 1)
    })
    /// AIRMET/SIGMET and navaids: day #963CC8 5.0:1, night systemPurple.
    static let layerAdvisory = Color(UIColor { trait in
        trait.userInterfaceStyle == .dark ? .systemPurple : UIColor(red: 0.588, green: 0.235, blue: 0.784, alpha: 1)
    })
    /// Weather dots: day #147832 5.0:1, night systemGreen.
    static let layerWeather = Color(UIColor { trait in
        trait.userInterfaceStyle == .dark ? .systemGreen : UIColor(red: 0.078, green: 0.471, blue: 0.196, alpha: 1)
    })
    /// Airport diagrams: day #007882 4.7:1, night systemTeal.
    static let layerDiagrams = Color(UIColor { trait in
        trait.userInterfaceStyle == .dark ? .systemTeal : UIColor(red: 0, green: 0.471, blue: 0.51, alpha: 1)
    })

    // Interactive accent: Kanaf navy, the blue of the app icon. Day #1556B8; Increase Contrast #0C4091.
    // Night (dark scheme = cockpit night palette): a muted, low-luminance blue so buttons don't glare (F16).
    // All pairs below are >= 4.5:1. `accentText` reads the `AccentColor` asset, which is also the app-wide tint.

    private static let accentDay = UIColor(red: 0.082, green: 0.337, blue: 0.722, alpha: 1)          // #1556B8
    private static let accentDayHighContrast = UIColor(red: 0.047, green: 0.251, blue: 0.569, alpha: 1) // #0C4091
    private static let accentNight = UIColor(red: 0.18, green: 0.29, blue: 0.43, alpha: 1)            // #2E4A6E

    /// Filled-button background (NRST, Direct-To, Recenter, Play, primary onboarding action).
    /// Day #1556B8 under white: 6.9:1 (Increase Contrast #0C4091: 9.7:1).
    /// Night #2E4A6E (L 0.06) under `onAccent` (L 0.57): 6.4:1.
    static let accent = Color(UIColor { trait in
        if trait.userInterfaceStyle == .dark { return accentNight }
        return trait.accessibilityContrast == .high ? accentDayHighContrast : accentDay
    })
    /// Text and glyphs drawn on `accent`.
    static let onAccent = Color(UIColor { trait in
        trait.userInterfaceStyle == .dark ? UIColor(white: 0.85, alpha: 1) : .white
    })
    /// Accent-coloured text/icons on a plain background (links, "selected" checkmarks, info glyphs).
    /// The `AccentColor` asset: day #1556B8 on #F2F2F7 6.2:1 (white 6.9:1); night #8FB4E0 on #1C1C1E 7.9:1
    /// (on black 9.8:1). Increase Contrast variants are darker by day and lighter by night.
    static let accentText = Color("AccentColor")
    /// Tinted container behind informational notices (beta banner, selected transcript row).
    static let infoFill = Color(UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? accentNight.withAlphaComponent(0.35)
            : accentDay.withAlphaComponent(0.15)
    })
}

// MARK: - Strip colors

/// Paper-and-ink colors for the Direction 2 strip and log stack. Day is a light paper; night is near-black
/// with warm ink and no filled amber blocks (amber rule + amber text instead).
extension Palette {
    /// Strip background: day #EEF0F2, night #0D1013.
    static let paper = dynamic(day: 0xEEF0F2, night: 0x0D1013)
    /// Section header bands: day #E2E5E9, night #232930.
    static let paperSecondary = dynamic(day: 0xE2E5E9, night: 0x232930)
    /// The NOW cell and the next row: day #FFFFFF, night #161A1F.
    static let activeCell = dynamic(day: 0xFFFFFF, night: 0x161A1F)
    /// Hairlines between rows and cells: day #C3C8CE, night #2A3037.
    static let rule = dynamic(day: 0xC3C8CE, night: 0x2A3037)
    /// Primary strip text: day #14191F, night #C9C4BA.
    static let ink = dynamic(day: 0x14191F, night: 0xC9C4BA)
    /// Strip labels: day #4A535E, night #8E9298.
    static let inkSecondary = dynamic(day: 0x4A535E, night: 0x8E9298)
    /// Magenta route glyphs in the strip: day #C2168D, night #93407A.
    static let route = dynamic(day: 0xC2168D, night: 0x93407A)
    /// Chart blue for airport idents and data blocks: day #1B58A3, night #86A3CB.
    static let airspace = dynamic(day: 0x1B58A3, night: 0x86A3CB)

    /// A color that follows `DisplayModeModifier`: `night` in the dark scheme, `day` otherwise (0xRRGGBB).
    private static func dynamic(day: UInt32, night: UInt32) -> Color {
        Color(UIColor { trait in
            let rgb = trait.userInterfaceStyle == .dark ? night : day
            return UIColor(
                red: CGFloat((rgb >> 16) & 0xFF) / 255,
                green: CGFloat((rgb >> 8) & 0xFF) / 255,
                blue: CGFloat(rgb & 0xFF) / 255,
                alpha: 1
            )
        })
    }
}

// MARK: - Map and category colors

/// Colors drawn into map layers and UIKit images (MapLibre takes `UIColor`), plus the flight-category dots.
/// Values are the system colors these call sites used before they were named here: no on-screen change.
/// Whether ownship, airspace and the weather dots should move to brand colors is a separate decision
/// to make over the sectional.
enum MapColor {
    /// Live ownship chevron.
    static let ownship = UIColor.systemBlue
    /// Ownship chevron when the last fix is stale.
    static let ownshipStale = UIColor.systemGray
    /// Airspace fill (10% opacity) and border.
    static let airspace = UIColor.systemBlue
    /// Weather station dots on the map.
    static let weatherDot = UIColor.systemGreen
    /// TFR fill and border (a warning area).
    static let tfr = UIColor.systemRed
    /// Replay track and marker. Amber by history, not a caution; recolouring it is a separate decision.
    static let replay = UIColor.systemOrange
    /// Minute-ruled track line, ticks and labels (Direction 2): strip ink day #14191F, night #B6B0A3;
    /// label halo white by day, the night paper #0D1013 at night.
    static let trackRulerDay = UIColor(red: 0x14 / 255, green: 0x19 / 255, blue: 0x1F / 255, alpha: 1)
    static let trackRulerNight = UIColor(red: 0xB6 / 255, green: 0xB0 / 255, blue: 0xA3 / 255, alpha: 1)
    static let trackRulerHaloDay = UIColor.white
    static let trackRulerHaloNight = UIColor(red: 0x0D / 255, green: 0x10 / 255, blue: 0x13 / 255, alpha: 1)
    /// NOTAM highlight on the map: full closure (red = warning), partial or needs-check (amber = caution), other.
    static let notamClosure = UIColor.systemRed
    static let notamCaution = UIColor.systemOrange
    static let notamInfo = UIColor.systemBlue
}

extension Palette {
    /// MVFR dot: day systemBlue, night a lighter blue so it stays distinct on the dark map.
    static let categoryMVFR = Color(UIColor { trait in
        trait.userInterfaceStyle == .dark ? UIColor(red: 0.56, green: 0.71, blue: 0.88, alpha: 1) : .systemBlue
    })
    /// LIFR dot: magenta by day, lighter by night.
    static let categoryLIFR = Color(UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 0.90, green: 0.45, blue: 0.90, alpha: 1)
            : UIColor(red: 0.80, green: 0.00, blue: 0.80, alpha: 1)
    })
}

// MARK: - Section header

/// Uppercase section heading with a bottom rule, shared by the airport sheet and layer panel.
struct SectionHeader: View {
    let title: String

    init(_ title: String) { self.title = title }

    var body: some View {
        Text(title)
            .font(TypeRole.sectionHeader)
            .foregroundStyle(Palette.secondaryText)
            .accessibilityAddTraits(.isHeader)
    }
}
