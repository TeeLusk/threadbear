import XCTest
@testable import ThreadbearCore

final class TabMentionsTests: XCTestCase {
    func tab(_ id: Int, _ title: String, _ url: String, whose: String = "user", allowed: Bool = true, lentTo: String? = nil) -> BrowserTab {
        BrowserTab(tabId: id, title: title, url: url, profile: "me@example.com", active: false, whose: whose, lentTo: lentTo, allowed: allowed)
    }

    func testQueryIsTheAtWordBeforeTheCursor() {
        XCTAssertEqual(TabMention.query(in: "@", cursor: 1), TabMention.Query(range: NSRange(location: 0, length: 1), text: ""))
        XCTAssertEqual(TabMention.query(in: "look at @you", cursor: 12)?.text, "you")
        XCTAssertEqual(TabMention.query(in: "look at @you", cursor: 12)?.range, NSRange(location: 8, length: 4))
        XCTAssertEqual(TabMention.query(in: "@you and more", cursor: 4)?.text, "you", "only up to the cursor")
        XCTAssertNil(TabMention.query(in: "mail me@example.com", cursor: 19), "an email address")
        XCTAssertNil(TabMention.query(in: "@you there", cursor: 10), "a space ends it")
        XCTAssertNil(TabMention.query(in: "@a\nb", cursor: 4))
        XCTAssertNil(TabMention.query(in: "hello", cursor: 5))
        XCTAssertNil(TabMention.query(in: "@[Music](https://m.example) (tab 3) ", cursor: 36), "a reference already made")
        XCTAssertEqual(TabMention.query(in: "line\n@x", cursor: 7)?.text, "x")
        XCTAssertEqual(TabMention.query(in: "🙂 @y", cursor: 5)?.range, NSRange(location: 3, length: 2), "UTF-16 offsets")
    }

    func testMatchesLeaveOutAgentTabsAndFilterOnTitleAndHost() {
        let tabs = [
            tab(1, "YouTube Music", "https://music.youtube.com/"),
            tab(2, "Agent's page", "https://example.com/", whose: "agent"),
            tab(3, "Inbox", "https://mail.google.com/mail/u/0/"),
            tab(4, "Dev", "http://localhost:5173/", whose: "handed"),
        ]
        XCTAssertEqual(TabMention.matches(tabs, query: "").map(\.tabId), [1, 3, 4])
        XCTAssertEqual(TabMention.matches(tabs, query: "MUS").map(\.tabId), [1])
        XCTAssertEqual(TabMention.matches(tabs, query: "google").map(\.tabId), [3], "by its host")
        XCTAssertEqual(TabMention.matches(tabs, query: "local").map(\.tabId), [4])
        XCTAssertEqual(TabMention.matches(tabs, query: "zzz"), [])
    }

    func testHostAndReference() {
        let t = tab(283150292, "YouTube Music", "https://music.youtube.com/")
        XCTAssertEqual(t.host, "music.youtube.com")
        XCTAssertEqual(tab(1, "x", "http://localhost:5173/a").host, "localhost:5173")
        XCTAssertEqual(TabMention.reference(t), "@[YouTube Music](https://music.youtube.com/) (tab 283150292)")
        XCTAssertEqual(TabMention.reference(tab(5, "a [b] c", "https://x.com/")), "@[a (b) c](https://x.com/) (tab 5)")
        XCTAssertEqual(TabMention.reference(tab(6, "  ", "https://x.com/")), "@[x.com](https://x.com/) (tab 6)")
        let long = String(repeating: "a", count: 100)
        XCTAssertEqual(TabMention.reference(tab(7, long, "https://x.com/")), "@[\(String(repeating: "a", count: 59))…](https://x.com/) (tab 7)")
    }

    func testMessageAddsWordsForTabsStillReferenced() {
        let lent = [5: "Tab 5 is yours.", 9: "Tab 9 is yours."]
        XCTAssertEqual(TabMention.message("see @[A](https://a.com/) (tab 5) please", lent: lent),
                       "see @[A](https://a.com/) (tab 5) please\n\nTab 5 is yours.")
        XCTAssertEqual(TabMention.message("no tabs", lent: lent), "no tabs")
        XCTAssertEqual(TabMention.message("(tab 9) and (tab 5)", lent: lent), "(tab 9) and (tab 5)\n\nTab 9 is yours.\n\nTab 5 is yours.")
        XCTAssertEqual(TabMention.message("(tab 55)", lent: lent), "(tab 55)", "not tab 5")
    }

    func testDecodesTheServicesList() throws {
        let json = #"[{"tabId":1,"title":"A","url":"https://a.com/","profile":"p","active":true,"whose":"user","lentTo":null,"allowed":false,"extra":1}]"#
        let tabs = try JSONDecoder().decode([BrowserTab].self, from: Data(json.utf8))
        XCTAssertEqual(tabs.first?.allowed, false)
        XCTAssertNil(tabs.first?.lentTo)
    }
}
