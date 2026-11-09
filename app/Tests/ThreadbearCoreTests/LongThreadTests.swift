import Foundation
import Testing
@testable import ThreadbearCore

/// The long thread card (protocol "Long threads"): when it shows, and Not now.
@Suite struct LongThreadTests {
    private func thread(_ long: String?, tokens: Int?, status: ThreadStatus = .idle) -> ThreadSummary {
        var t = ThreadSummary(id: "t1", title: "T", status: status, contextTokens: tokens)
        t.contextLong = long
        return t
    }

    @Test func showsTheRunnersLevelBetweenTurnsOnly() {
        #expect(LongThread.card(for: thread(nil, tokens: 100_000), dismissed: nil) == nil)
        #expect(LongThread.card(for: thread("gentle", tokens: 160_000), dismissed: nil) == .suggest(firm: false, tokens: 160_000))
        #expect(LongThread.card(for: thread("firm", tokens: 260_000), dismissed: nil) == .suggest(firm: true, tokens: 260_000))
        #expect(LongThread.card(for: thread("firm", tokens: 260_000, status: .running), dismissed: nil) == nil)
        // A level from a newer runner it doesn't know.
        #expect(LongThread.card(for: thread("huge", tokens: 900_000), dismissed: nil) == nil)
    }

    @Test func notNowHoldsUntilTheNextLevel() throws {
        let gentle = try #require(LongThread.card(for: thread("gentle", tokens: 160_000), dismissed: nil))
        let dismissed = gentle.dismissal(tokens: 160_000)
        #expect(LongThread.card(for: thread("gentle", tokens: 200_000), dismissed: dismissed) == nil)
        #expect(LongThread.card(for: thread("firm", tokens: 255_000), dismissed: dismissed) == .suggest(firm: true, tokens: 255_000))
        let firm = LongThread.suggest(firm: true, tokens: 255_000).dismissal(tokens: 255_000)
        #expect(LongThread.card(for: thread("firm", tokens: 400_000), dismissed: firm) == nil)
    }

    @Test func aCompactVoidsNotNow() {
        let dismissed = LongThread.Dismissal(rank: 2, tokens: 300_000)
        // Compacted to 20k, then grown past the gentle level again.
        #expect(LongThread.card(for: thread("gentle", tokens: 170_000), dismissed: dismissed) == .suggest(firm: false, tokens: 170_000))
    }

    @Test func theHandoffAndWhereItWent() {
        var t = thread("firm", tokens: 300_000, status: .running)
        t.continuing = true
        #expect(LongThread.card(for: t, dismissed: nil) == .writing)
        t.continuing = false
        t.status = .idle
        t.continuedIn = ContinuedIn(threadId: "t2", title: "T (continued)")
        let card = LongThread.card(for: t, dismissed: nil)
        #expect(card == .continued(ContinuedIn(threadId: "t2", title: "T (continued)")))
        #expect(card?.message == "Carried on in \u{201C}T (continued)\u{201D}.")
        #expect(LongThread.card(for: t, dismissed: card?.dismissal(tokens: 300_000)) == nil)
    }

    @Test func decodesTheSummaryFields() throws {
        let json = #"{"id":"t1","title":"T","cwd":"/x","accountId":"a","provider":"claude","permissionMode":"full","status":"idle","createdAt":"2026-11-08T00:00:00Z","updatedAt":"2026-11-08T00:00:00Z","lastActivityAt":"2026-11-08T00:00:00Z","preview":"","lastSeq":1,"lastSeenSeq":1,"contextTokens":160000,"contextLong":"gentle","continuing":true,"continuedIn":{"threadId":"t2","title":"Next"}}"#
        let t = try JSONDecoder().decode(ThreadSummary.self, from: Data(json.utf8))
        #expect(t.contextLong == "gentle")
        #expect(t.continuing)
        #expect(t.continuedIn == ContinuedIn(threadId: "t2", title: "Next"))
        let again = try JSONDecoder().decode(ThreadSummary.self, from: JSONEncoder().encode(t))
        #expect(again.continuedIn == t.continuedIn)
    }
}
