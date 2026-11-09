import Foundation

/// One of Tyler's Chrome tabs, as BrowserBear's `tabList` gives it for the
/// composer's @ picker.
public struct BrowserTab: Codable, Equatable, Sendable, Identifiable {
    public var tabId: Int
    public var title: String
    public var url: String
    public var profile: String?
    public var active: Bool?
    /// "user", "handed" (an agent's, handed over to him) or "agent".
    public var whose: String?
    /// The thread it's lent to, if any.
    public var lentTo: String?
    /// Whether the thread asked about may use this tab already: its site
    /// is on the allowed list, or the tab is lent to that thread. Picking
    /// it lends that one tab, never the whole site.
    public var allowed: Bool?

    public var id: Int { tabId }

    public init(tabId: Int, title: String, url: String, profile: String? = nil, active: Bool? = nil,
                whose: String? = nil, lentTo: String? = nil, allowed: Bool? = nil) {
        self.tabId = tabId
        self.title = title
        self.url = url
        self.profile = profile
        self.active = active
        self.whose = whose
        self.lentTo = lentTo
        self.allowed = allowed
    }

    /// "music.youtube.com", "localhost:5173"; the whole address for a file.
    public var host: String {
        guard let parts = URLComponents(string: url), let host = parts.host, !host.isEmpty else { return url }
        return parts.port.map { "\(host):\($0)" } ?? host
    }
}

/// The @ picker in the message box: typing "@" lists Tyler's open Chrome
/// tabs from BrowserBear, and picking one lends it to the thread and puts
/// a short reference to it in the message.
public enum TabMention {
    /// The "@word" being typed, as UTF-16 offsets into the box's text.
    public struct Query: Equatable, Sendable {
        public var range: NSRange
        public var text: String
        public init(range: NSRange, text: String) {
            self.range = range
            self.text = text
        }
    }

    /// The "@..." just before the cursor: an @ at the start or after a
    /// space, then no space, picture or bracket up to the cursor. Nil for
    /// an email address ("me@x.com") or once a space ends the word.
    public static func query(in text: String, cursor: Int) -> Query? {
        let units = Array(text.utf16)
        guard cursor > 0, cursor <= units.count else { return nil }
        var i = cursor - 1
        while i >= 0 {
            let u = units[i]
            if u == 0x40 { // @
                if i > 0, !isSpace(units[i - 1]) { return nil }
                let word = String(utf16CodeUnits: Array(units[(i + 1)..<cursor]), count: cursor - i - 1)
                return Query(range: NSRange(location: i, length: cursor - i), text: word)
            }
            if isSpace(u) || u == 0xFFFC || u == 0x5B || u == 0x5D { return nil }
            i -= 1
        }
        return nil
    }

    private static func isSpace(_ u: UInt16) -> Bool {
        u == 0x20 || u == 0x09 || u == 0x0A || u == 0x0D || u == 0xA0
    }

    /// The tabs to offer: his own and those handed to him, never an agent's
    /// own, in BrowserBear's order (his first, the front ones first), those
    /// whose title or host has `query`.
    public static func matches(_ tabs: [BrowserTab], query: String) -> [BrowserTab] {
        let mine = tabs.filter { $0.whose != "agent" }
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return mine }
        return mine.filter { $0.title.localizedCaseInsensitiveContains(q) || $0.host.localizedCaseInsensitiveContains(q) }
    }

    /// What goes in the message for a picked tab:
    /// `@[YouTube Music](https://music.youtube.com/) (tab 283150292)`.
    public static func reference(_ tab: BrowserTab) -> String {
        var title = tab.title.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "[", with: "(")
            .replacingOccurrences(of: "]", with: ")")
            .replacingOccurrences(of: "\n", with: " ")
        if title.isEmpty { title = tab.host }
        if title.count > 60 { title = String(title.prefix(59)) + "…" }
        return "@[\(title)](\(tab.url)) (tab \(tab.tabId))"
    }

    /// The message as sent: BrowserBear's words for each lent tab the text
    /// still refers to, after it, in the order they're mentioned. The
    /// reference says which tab; the words say how to use it.
    public static func message(_ text: String, lent: [Int: String]) -> String {
        let found = lent.compactMap { id, words -> (Int, String)? in
            guard let at = text.range(of: "(tab \(id))") else { return nil }
            return (text.distance(from: text.startIndex, to: at.lowerBound), words)
        }.sorted { $0.0 < $1.0 }
        guard !found.isEmpty else { return text }
        return ([text] + found.map(\.1)).joined(separator: "\n\n")
    }

    /// Said for a tab whose lend hasn't answered by the time it's sent.
    public static func fallbackWords(_ tab: BrowserTab) -> String {
        "I've lent you tab \(tab.tabId) in my Chrome through BrowserBear, \"\(tab.title.prefix(80))\" <\(tab.url)>. "
            + "Start with `browserbear snap \(tab.tabId)`. It's my own tab: don't close it, and run `browserbear release \(tab.tabId)` when you've finished with it. "
            + "You may use it on \(tab.host) even if that site isn't on the allowed list, but only in this tab and only in this thread."
    }
}
