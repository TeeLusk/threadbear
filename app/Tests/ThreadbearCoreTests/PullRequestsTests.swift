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
}
