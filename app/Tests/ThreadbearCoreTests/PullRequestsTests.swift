import XCTest
@testable import ThreadbearCore

final class PullRequestsTests: XCTestCase {
    private func pr(
        _ number: Int, _ state: PRState, checks: PRChecksState? = nil, review: PRReviewDecision? = nil,
        conflicts: Bool = false, checkedAt: Date? = Date()
    ) -> ThreadPR {
        ThreadPR(
            url: "https://github.com/acme/widgets/pull/\(number)", repo: "acme/widgets", number: number,
            title: "PR \(number)", state: state,
            checks: checks.map { PRChecks(state: $0, passed: 1, total: 2) },
            review: review.map { PRReviewSummary(decision: $0, approvals: 0, required: nil) },
            conflicts: conflicts, checkedAt: checkedAt)
    }

    func testDecodesSummaryWithoutPRs() throws {
        let json = #"{"id":"t1","title":"x"}"#
        let s = try JSONDecoder().decode(ThreadSummary.self, from: Data(json.utf8))
        XCTAssertEqual(s.prs, [])
    }

    func testMalformedPRsDecodeToEmpty() throws {
        let json = #"{"id":"t1","title":"x","prs":"nope"}"#
        let s = try JSONDecoder().decode(ThreadSummary.self, from: Data(json.utf8))
        XCTAssertEqual(s.prs, [])
    }

    func testDecodesAndRoundTripsPRs() throws {
        let json = """
        {"id":"t1","title":"x","prs":[{"url":"https://github.com/acme/widgets/pull/7","repo":"acme/widgets","number":7,
        "title":"Add","state":"open","checks":{"state":"failing","passed":1,"total":3},
        "review":{"decision":"changes","approvals":0,"required":2},"conflicts":true,"checkedAt":"2026-11-06T10:00:00Z"}]}
        """
        let s = try JSONDecoder().decode(ThreadSummary.self, from: Data(json.utf8))
        XCTAssertEqual(s.prs.count, 1)
        XCTAssertEqual(s.prs[0].checks?.state, .failing)
        XCTAssertEqual(s.prs[0].review?.required, 2)
        XCTAssertTrue(s.prs[0].conflicts)
        XCTAssertEqual(s.prs[0].checkedAt, ISO8601.parse("2026-11-06T10:00:00Z"))
        let again = try JSONDecoder().decode(ThreadSummary.self, from: JSONEncoder().encode(s))
        XCTAssertEqual(again.prs, s.prs)
    }

    func testUnknownStateDecodes() throws {
        let json = """
        {"id":"t1","title":"x","prs":[{"url":"u","repo":"a/b","number":1,"title":"t","state":"queued",
        "checks":{"state":"weird","passed":0,"total":0},"checkedAt":"2026-11-06T10:00:00Z"}]}
        """
        let s = try JSONDecoder().decode(ThreadSummary.self, from: Data(json.utf8))
        XCTAssertEqual(s.prs[0].state, .unknown)
        XCTAssertEqual(s.prs[0].checks?.state, .unknown)
        XCTAssertEqual(PRBadge.tone(s.prs), .draft)
    }

    func testDetailDecodes() throws {
        let json = """
        {"prs":[{"url":"u","repo":"a/b","number":1,"title":"t","state":"open","headRef":"h","baseRef":"main",
        "checkList":[{"name":"build","outcome":"failed","seconds":12},{"name":"x","outcome":"odd"}],
        "reviews":[{"author":"x","state":"changes"}],"requested":["y"]}]}
        """
        let list = try JSONDecoder().decode(PRDetailList.self, from: Data(json.utf8)).prs
        XCTAssertEqual(list[0].checkList.map(\.outcome), [.failed, .unknown])
        XCTAssertEqual(list[0].requested, ["y"])
        XCTAssertEqual(list[0].pr.number, 1)
    }

    func testToneOrder() {
        XCTAssertEqual(PRBadge.tone([pr(1, .merged), pr(2, .open, checks: .failing)]), .failing)
        XCTAssertEqual(PRBadge.tone([pr(1, .open, conflicts: true)]), .failing)
        XCTAssertEqual(PRBadge.tone([pr(1, .open, review: .changes)]), .failing)
        XCTAssertEqual(PRBadge.tone([pr(1, .merged), pr(2, .open, checks: .running)]), .running)
        XCTAssertEqual(PRBadge.tone([pr(1, .open, checks: .passing)]), .open)
        XCTAssertEqual(PRBadge.tone([pr(1, .merged), pr(2, .merged)]), .merged)
        XCTAssertEqual(PRBadge.tone([pr(1, .closed)]), .closed)
        XCTAssertEqual(PRBadge.tone([pr(1, .draft)]), .draft)
        XCTAssertEqual(PRBadge.tone([pr(1, .open, checkedAt: nil)]), .draft)
        XCTAssertNil(PRBadge.tone([]))
    }

    func testTooltip() {
        let prs = [pr(683, .open, checks: .failing), pr(681, .merged)]
        XCTAssertEqual(PRBadge.tooltip(prs), "2 pull requests: #683 checks failing, #681 merged")
        XCTAssertEqual(PRBadge.tooltip([pr(5, .open, checks: .passing)]), "1 pull request: #5 checks passing")
    }

    private func detail(_ review: PRReviewSummary?, reviews: [PRReview] = [], requested: [String] = []) -> PRDetail {
        var p = pr(1, .open)
        p.review = review
        return PRDetail(pr: p, headRef: "h", baseRef: "main", checkList: [], reviews: reviews, requested: requested)
    }

    func testReviewLine() {
        XCTAssertEqual(PRBadge.reviewLine(detail(.init(decision: .waiting, approvals: 1, required: 2))), "1 of 2 approvals")
        XCTAssertEqual(PRBadge.reviewLine(detail(.init(decision: .approved, approvals: 2, required: 2))), "Approved")
        XCTAssertEqual(
            PRBadge.reviewLine(detail(.init(decision: .changes, approvals: 0, required: nil), reviews: [PRReview(author: "x", state: .changes)])),
            "Changes requested by @x")
        XCTAssertEqual(PRBadge.reviewLine(detail(.init(decision: .waiting, approvals: 0, required: nil), requested: ["bo"])), "Waiting for review from @bo")
        XCTAssertEqual(PRBadge.reviewLine(detail(.init(decision: .waiting, approvals: 0, required: nil))), "Waiting for review")
        XCTAssertNil(PRBadge.reviewLine(detail(nil)))
        XCTAssertNil(PRBadge.reviewLine(detail(.init(decision: .none, approvals: 0, required: nil))))
    }

    func testTrackedPRsLeaveLinks() {
        let tracked = "https://github.com/acme/widgets/pull/7"
        let untracked = "https://github.com/acme/widgets/pull/9"
        let highlights = ThreadHighlights(highlights: [
            Highlight(id: "pr:7", kind: .pr, title: "acme/widgets#7", url: tracked),
            Highlight(id: "pr:9", kind: .pr, title: "acme/widgets#9", url: untracked),
            Highlight(id: "link:1", kind: .link, title: "Docs", url: "https://example.com/docs"),
        ])
        let sections = HighlightSections.build(PRBadge.withoutTracked(highlights, prs: [pr(7, .open)]))
        XCTAssertEqual(sections.links.map(\.url), [untracked, "https://example.com/docs"])
        // No tracked PRs: nothing changes.
        XCTAssertEqual(PRBadge.withoutTracked(highlights, prs: []), highlights)
    }

    func testCardLines() {
        XCTAssertEqual(PRBadge.subtitle(pr(683, .merged)), "widgets #683 · Merged")
        XCTAssertEqual(PRBadge.subtitle(pr(5, .unknown)), "widgets #5")
        // Never fetched: the runner's "open" is a placeholder, so no state word.
        XCTAssertEqual(PRBadge.subtitle(pr(6, .open, checkedAt: nil)), "widgets #6")
        XCTAssertEqual(PRBadge.subtitle(pr(6, .open)), "widgets #6 · Open")
        XCTAssertEqual(PRBadge.checksLine(pr(1, .open, checks: .failing)), "Checks · 1 of 2 passed")
        XCTAssertNil(PRBadge.checksLine(pr(1, .open)))
        let now = Date()
        XCTAssertEqual(PRBadge.checkedLine(now.addingTimeInterval(-43), now: now), "Checked 40s ago")
        XCTAssertEqual(PRBadge.checkedLine(now.addingTimeInterval(-3), now: now), "Checked just now")
        XCTAssertEqual(PRBadge.checkedLine(now.addingTimeInterval(-300), now: now), "Checked 5m ago")
        XCTAssertEqual(PRBadge.checkedLine(nil, now: now), "Not checked yet")
        XCTAssertTrue(PRBadge.fixChecksPrompt("https://github.com/acme/widgets/pull/7")
            .hasPrefix("This pull request's checks are failing: https://github.com/acme/widgets/pull/7. Look with `gh pr checks https://github.com/acme/widgets/pull/7`"))
    }

    func testFixFailingChecksOnlyForOpenOrDraft() {
        XCTAssertTrue(PRBadge.canFixChecks(pr(1, .open, checks: .failing)))
        XCTAssertTrue(PRBadge.canFixChecks(pr(1, .draft, checks: .failing)))
        XCTAssertFalse(PRBadge.canFixChecks(pr(1, .merged, checks: .failing)))
        XCTAssertFalse(PRBadge.canFixChecks(pr(1, .closed, checks: .failing)))
        XCTAssertFalse(PRBadge.canFixChecks(pr(1, .unknown, checks: .failing)))
        XCTAssertFalse(PRBadge.canFixChecks(pr(1, .open, checks: .passing)))
        XCTAssertFalse(PRBadge.canFixChecks(pr(1, .open)))
    }

    func testChecksSortFailedFirst() {
        let checks = [
            PRCheck(name: "a", outcome: .passed), PRCheck(name: "b", outcome: .skipped),
            PRCheck(name: "c", outcome: .running), PRCheck(name: "d", outcome: .failed),
            PRCheck(name: "e", outcome: .passed),
        ]
        XCTAssertEqual(PRBadge.sortedChecks(checks).map(\.name), ["d", "c", "a", "e", "b"])
    }

    func testCheckTrailing() {
        // GitHub gives skipped runs start and end times; they still read as skipped.
        XCTAssertEqual(PRBadge.checkTrailing(PRCheck(name: "a", outcome: .skipped, seconds: 0)), "skipped")
        XCTAssertEqual(PRBadge.checkTrailing(PRCheck(name: "a", outcome: .skipped)), "skipped")
        XCTAssertEqual(PRBadge.checkTrailing(PRCheck(name: "a", outcome: .passed, seconds: 64)), "1m 4s")
        XCTAssertNil(PRBadge.checkTrailing(PRCheck(name: "a", outcome: .running)))
    }

    func testOnlyWebLinksOpen() {
        XCTAssertNotNil(PRBadge.webLink("https://github.com/acme/widgets/pull/7"))
        XCTAssertNotNil(PRBadge.webLink("http://ci.example.com/7"))
        XCTAssertNil(PRBadge.webLink("javascript:alert(1)"))
        XCTAssertNil(PRBadge.webLink("file:///etc/passwd"))
        XCTAssertNil(PRBadge.webLink(nil))
    }
}
