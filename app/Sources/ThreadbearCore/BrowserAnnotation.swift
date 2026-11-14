import Foundation

/// What BrowserBear's Annotate sends back from a page in Chrome: the comment,
/// what was marked, and the page it was on (BrowserBear's
/// extension/annotation.js, adapted from jwsandeman's Threadbear fork). The
/// page wrote it, so every list and string is bounded before it goes near a
/// message box.
public struct BrowserAnnotation: Codable, Equatable {
    public struct Point: Codable, Equatable { public var x: Double; public var y: Double }
    public struct Rect: Codable, Equatable {
        public var x: Double; public var y: Double; public var width: Double; public var height: Double
        var valid: Bool { [x, y, width, height].allSatisfy { $0.isFinite && abs($0) <= 10_000_000 } && width >= 0 && height >= 0 }
    }
    public struct Element: Codable, Equatable {
        public var selector: String; public var tagName: String; public var outerHTML: String; public var text: String
        public var styles: [String: String]; public var rect: Rect
    }
    public struct Stroke: Codable, Equatable { public var points: [Point] }
    public struct Viewport: Codable, Equatable { public var width: Double; public var height: Double; public var scrollX: Double; public var scrollY: Double }

    public var url: String
    public var title: String
    public var comment: String
    public var elements: [Element]
    public var regions: [Rect]
    public var strokes: [Stroke]
    public var viewport: Viewport

    public enum Invalid: Error { case shape }

    /// From BrowserBear's file, refusing anything oversized or malformed.
    public static func decode(_ data: Data) throws -> Self {
        guard data.count <= 512 * 1024 else { throw Invalid.shape }
        let value = try JSONDecoder().decode(Self.self, from: data)
        guard value.url.count <= 8192, value.title.count <= 1024, value.comment.count <= 16000,
              value.elements.count <= 20, value.regions.count <= 20, value.strokes.count <= 100,
              !value.elements.isEmpty || !value.regions.isEmpty || !value.strokes.isEmpty,
              value.strokes.reduce(0, { $0 + $1.points.count }) <= 20_000,
              [value.viewport.width, value.viewport.height, value.viewport.scrollX, value.viewport.scrollY].allSatisfy({ $0.isFinite && abs($0) <= 10_000_000 }),
              value.viewport.width > 0, value.viewport.height > 0,
              value.elements.allSatisfy({ $0.selector.count <= 2048 && $0.tagName.count <= 128 && $0.outerHTML.count <= 16000 && $0.text.count <= 4000 && $0.styles.count <= 64 && $0.rect.valid }),
              value.regions.allSatisfy(\.valid),
              value.strokes.allSatisfy({ !$0.points.isEmpty && $0.points.allSatisfy { $0.x.isFinite && $0.y.isFinite } })
        else { throw Invalid.shape }
        return value
    }

    /// The words for the message box: the comment first, then where on the
    /// page, in a form an agent can find in the code (selector, tag, a little
    /// of the HTML) without the whole captured context, which ran to pages.
    /// Positions are CSS pixels in the viewport, as in the screenshot.
    public func draftText(screenshot: Bool) -> String {
        var lines: [String] = []
        let page = title.isEmpty ? url : "\"\(Self.oneLine(title, 120))\" <\(url)>"
        lines.append("Browser annotation on \(page)")
        lines.append("")
        lines.append(comment.isEmpty ? "Please look at the marked parts of the page." : comment)
        lines.append("")
        lines.append("Marked\(screenshot ? " (shown in the screenshot)" : ""), viewport \(Self.n(viewport.width))×\(Self.n(viewport.height)) scrolled to \(Self.n(viewport.scrollX)),\(Self.n(viewport.scrollY)):")
        for element in elements {
            let words = Self.oneLine(element.text, 80)
            lines.append("- `\(Self.oneLine(element.selector, 300))`\(words.isEmpty ? "" : " \"\(words)\"") at \(Self.place(element.rect))")
            let html = Self.oneLine(element.outerHTML, 300)
            if !html.isEmpty { lines.append("  `\(html.replacingOccurrences(of: "`", with: "'"))`") }
        }
        for region in regions { lines.append("- A region at \(Self.place(region))") }
        if !strokes.isEmpty {
            lines.append(screenshot
                ? "- \(strokes.count) drawn \(strokes.count == 1 ? "line" : "lines")"
                : "- \(strokes.count) drawn \(strokes.count == 1 ? "line" : "lines") (no screenshot), around \(strokes.map { Self.place(Self.bounds($0)) }.joined(separator: "; "))")
        }
        return lines.joined(separator: "\n").replacingOccurrences(of: InlinePictures.markString, with: "")
    }

    private static func place(_ r: Rect) -> String { "\(n(r.x)),\(n(r.y)) \(n(r.width))×\(n(r.height))" }
    private static func n(_ v: Double) -> String { String(Int(v.rounded())) }
    private static func bounds(_ s: Stroke) -> Rect {
        let xs = s.points.map(\.x), ys = s.points.map(\.y)
        return Rect(x: xs.min() ?? 0, y: ys.min() ?? 0, width: (xs.max() ?? 0) - (xs.min() ?? 0), height: (ys.max() ?? 0) - (ys.min() ?? 0))
    }
    private static func oneLine(_ s: String, _ max: Int) -> String {
        let flat = s.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        return flat.count > max ? String(flat.prefix(max)) + "…" : flat
    }
}
