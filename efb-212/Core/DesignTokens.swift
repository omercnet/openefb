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

// MARK: - Type roles

/// Type roles built from Dynamic Type text styles. Values are emphasized over labels:
/// a label is small and secondary, the value it describes is larger and primary.
enum TypeRole {
    /// Airport identifier / sheet title.
    static let title = Font.system(.largeTitle, design: .rounded, weight: .semibold)
    /// Section heading, e.g. "FREQUENCIES".
    static let sectionHeader = Font.caption.weight(.bold)
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
    /// Sectional toggle. Day systemBlue 3.6:1; night #4678BE 3.8:1 (`accent` night is 1.9:1).
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

    // Interactive accent. Day: system blue. Night (dark scheme = cockpit night palette): a muted,
    // low-luminance blue so buttons don't glare (F16). All pairs below are >= 4.5:1.

    /// Filled-button background (NRST, Direct-To, Recenter, Play, primary onboarding action).
    /// Night #2E4A6E (L 0.06) under `onAccent` (L 0.57): 5.4:1. Day: white on systemBlue, 4.6:1.
    static let accent = Color(UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 0.18, green: 0.29, blue: 0.43, alpha: 1)
            : .systemBlue
    })
    /// Text and glyphs drawn on `accent`.
    static let onAccent = Color(UIColor { trait in
        trait.userInterfaceStyle == .dark ? UIColor(white: 0.85, alpha: 1) : .white
    })
    /// Accent-coloured text/icons on a plain background (links, "selected" checkmarks, info glyphs).
    /// Night #8FB4E0 on black: 9.8:1; day systemBlue on white: 4.5:1 (large/bold glyphs).
    static let accentText = Color(UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 0.56, green: 0.71, blue: 0.88, alpha: 1)
            : .systemBlue
    })
    /// Tinted container behind informational notices (beta banner, selected transcript row).
    static let infoFill = Color(UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 0.18, green: 0.29, blue: 0.43, alpha: 0.35)
            : UIColor.systemBlue.withAlphaComponent(0.15)
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
