import AppKit
import SwiftUI
import ThreadbearCore

/// GitHub Primer's colours for pull requests, light and dark
/// (docs/pr-status-design, "The sidebar badge").
extension PRTone {
    var color: Color {
        switch self {
        case .open: return PRPalette.green
        case .merged: return PRPalette.purple
        case .failing: return PRPalette.red
        // Closed without merging: red, dimmed, as it's over and needs nothing.
        case .closed: return PRPalette.red.opacity(0.6)
        case .running: return PRPalette.amber
        case .draft: return PRPalette.grey
        }
    }
}

enum PRPalette {
    static let green = tone(light: 0x1F883D, dark: 0x3FB950)
    static let purple = tone(light: 0x8250DF, dark: 0xA371F7)
    static let red = tone(light: 0xCF222E, dark: 0xF85149)
    static let amber = tone(light: 0x9A6700, dark: 0xD29922)
    static let grey = tone(light: 0x59636E, dark: 0x9198A1)

    private static func tone(light: Int, dark: Int) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            rgb(appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light)
        })
    }

    private static func rgb(_ hex: Int) -> NSColor {
        NSColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}
