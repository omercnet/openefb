//
//  DesignTokens.swift
//  efb-212
//
//  Spacing scale, type roles and semantic colors (docs/DESIGN.md `## Tokens`).
//  Colors are SwiftUI semantic colors so the night-mode / HIG ticket can swap palettes in one place.
//  EFB rule: red = warning, amber = caution, nothing else.
//

import SwiftUI

// MARK: - Spacing

/// 4-point spacing scale. Spacing between groups must exceed spacing within a group.
enum Space {
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

/// Type roles built from Dynamic Type text styles. Values are emphasized over labels:
/// a label is small and secondary, the value it describes is larger and primary.
/// Kanaf voice: expanded SF Pro for names and headings, regular width for values read up close,
/// condensed SF Pro with fixed-width digits for the instrument readouts (SF Mono ignores width).
enum TypeRole {
    /// Airport identifier / sheet title.
    static let title = Font.system(.largeTitle, weight: .bold).width(.expanded)
    /// Compact identifier next to a distance, e.g. "KPAO" in the NRST box.
    static let identifier = Font.title3.weight(.bold).width(.expanded)
    /// Section heading, e.g. "FREQUENCIES".
    static let sectionHeader = Font.caption.weight(.bold).width(.expanded)
    /// Instrument readout digits at an exact point size (the caller scales it with `@ScaledMetric`).
    static func readout(size: CGFloat) -> Font {
        Font.system(size: size, weight: .semibold).width(.condensed).monospacedDigit()
    }
    /// Field label, e.g. "Wind", "TWR". Always paired with `Palette.secondaryText`.
    static let label = Font.footnote.weight(.medium)
    /// Primary value: frequency, runway ident, decoded weather.
    static let value = Font.title3.monospacedDigit().weight(.semibold)
    /// Secondary value: smaller readout next to a primary one.
    static let valueSmall = Font.callout.monospacedDigit().weight(.medium)
    /// Body text.
    static let body = Font.subheadline
    /// Footnotes, source and validity lines.
    static let caption = Font.footnote
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
    static let northMarker = Color.red
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

// MARK: - Floating control surface

extension View {
    /// Surface for floating in-flight map controls: Kanaf-navy tinted Liquid Glass with `Palette.onAccent` glyphs.
    /// Always tinted: untinted glass takes on the sectional's yellow and loses glyph contrast. Group neighbouring
    /// surfaces in a `GlassEffectContainer`. Reduce Transparency is handled by the system.
    func mapControlSurface(cornerRadius: CGFloat = MapControlMetrics.cornerRadius) -> some View {
        mapControlSurface(in: .rect(cornerRadius: cornerRadius))
    }

    /// Same surface in any shape, e.g. the round record button.
    func mapControlSurface(in shape: some Shape) -> some View {
        foregroundStyle(Palette.onAccent)
            .glassEffect(.regular.tint(Palette.accent), in: shape)
    }
}
