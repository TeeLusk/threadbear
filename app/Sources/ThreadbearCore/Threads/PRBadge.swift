import Foundation

/// What a thread's pull requests add up to, for the sidebar badge.
public enum PRTone: Sendable, Hashable { case failing, running, open, draft, merged, closed }

public enum PRBadge {
    /// A PR the runner hasn't looked at yet, or one in a state this app
    /// doesn't know, reads as grey like a draft.
    private static func effectiveState(_ pr: ThreadPR) -> PRState {
        pr.checkedAt == nil || pr.state == .unknown ? .draft : pr.state
    }

    private static func isFailing(_ pr: ThreadPR) -> Bool {
        effectiveState(pr) == .open
            && (pr.checks?.state == .failing || pr.conflicts || pr.review?.decision == .changes)
    }

    /// Worst first: failing, running, open, draft, merged, closed. Nil for none.
    public static func tone(_ prs: [ThreadPR]) -> PRTone? {
        if prs.isEmpty { return nil }
        if prs.contains(where: isFailing) { return .failing }
        if prs.contains(where: { effectiveState($0) == .open && $0.checks?.state == .running }) { return .running }
        let states = prs.map(effectiveState)
        if states.contains(.open) { return .open }
        if states.contains(.draft) { return .draft }
        if states.contains(.merged) { return .merged }
        return .closed
    }

    /// "2 pull requests: #683 checks failing, #681 merged".
    public static func tooltip(_ prs: [ThreadPR]) -> String {
        guard !prs.isEmpty else { return "" }
        let head = prs.count == 1 ? "1 pull request" : "\(prs.count) pull requests"
        return head + ": " + prs.map { "#\($0.number) \(phrase($0))" }.joined(separator: ", ")
    }

    private static func phrase(_ pr: ThreadPR) -> String {
        switch effectiveState(pr) {
        case .merged: return "merged"
        case .closed: return "closed"
        case .draft: return pr.state == .draft ? "draft" : "not checked yet"
        default:
            if pr.checks?.state == .failing { return "checks failing" }
            if pr.conflicts { return "has conflicts" }
            if pr.review?.decision == .changes { return "changes requested" }
            if pr.checks?.state == .running { return "checks running" }
            if pr.checks?.state == .passing { return "checks passing" }
            return "open"
        }
    }

    /// Under a card's title: "widgets #683 · Merged". The repo's name
    /// without its owner, as GitHub's own lists show it.
    public static func subtitle(_ pr: ThreadPR) -> String {
        let name = pr.repo.split(separator: "/").last.map(String.init) ?? pr.repo
        let head = name.isEmpty ? "#\(pr.number)" : "\(name) #\(pr.number)"
        let word: String? = switch pr.state {
        case .open: "Open"
        case .draft: "Draft"
        case .merged: "Merged"
        case .closed: "Closed"
        case .unknown: nil
        }
        return word.map { "\(head) · \($0)" } ?? head
    }

    /// "Checks · 12 of 13 passed"; nil when the PR has no checks.
    public static func checksLine(_ pr: ThreadPR) -> String? {
        guard let checks = pr.checks, checks.total > 0 else { return nil }
        return "Checks · \(checks.passed) of \(checks.total) passed"
    }

    /// Failed first, then running, passed and skipped, each kept in the
    /// runner's order.
    public static func sortedChecks(_ checks: [PRCheck]) -> [PRCheck] {
        func rank(_ outcome: PROutcome) -> Int {
            switch outcome {
            case .failed: 0
            case .running: 1
            case .passed: 2
            case .skipped: 3
            case .unknown: 4
            }
        }
        return checks.enumerated()
            .sorted { (rank($0.element.outcome), $0.offset) < (rank($1.element.outcome), $1.offset) }
            .map(\.element)
    }

    /// A check row's trailing text: how long it took, or "skipped" for a
    /// skipped one, whose start and end times GitHub still gives.
    public static func checkTrailing(_ check: PRCheck) -> String? {
        if check.outcome == .skipped { return "skipped" }
        return check.seconds.map { RelativeTime.duration(milliseconds: Double($0) * 1000) }
    }

    /// A PR's or check's link as something to open, only when it's a web
    /// page: these come from GitHub, and a check's from whoever set it up.
    public static func webLink(_ text: String?) -> URL? {
        guard let text, let url = URL(string: text), PreviewRules.isWebPage(url) else { return nil }
        return url
    }

    /// "Checked 40s ago", so a stale card says it's stale.
    public static func checkedLine(_ checkedAt: Date?, now: Date) -> String {
        guard let checkedAt else { return "Not checked yet" }
        let seconds = max(0, now.timeIntervalSince(checkedAt))
        if seconds < 10 { return "Checked just now" }
        if seconds < 60 { return "Checked \(Int(seconds) / 10 * 10)s ago" }
        if seconds < 86_400 { return "Checked \(RelativeTime.short(checkedAt, now: now)) ago" }
        return "Checked \(RelativeTime.short(checkedAt, now: now))"
    }

    /// What "Fix failing checks" sends the thread, naming the PR, as a
    /// thread can have several.
    public static func fixChecksPrompt(_ url: String) -> String {
        "This pull request's checks are failing: \(url). Look with `gh pr checks \(url)` and `gh run view <run-id> --log-failed`, find the cause, fix it, and push. Tell me if a failure isn't from this branch's changes."
    }

    /// The highlights without the PR links the Pull requests section
    /// already shows, so a PR isn't listed twice. A pinned one stays: it was
    /// pinned on purpose and may have a note.
    public static func withoutTracked(_ highlights: ThreadHighlights, prs: [ThreadPR]) -> ThreadHighlights {
        guard !prs.isEmpty else { return highlights }
        let tracked = Set(prs.map { trimmed($0.url) })
        var kept = highlights
        kept.highlights.removeAll { item in
            item.kind == .pr && !item.isPinned && item.url.map { tracked.contains(trimmed($0)) } == true
        }
        return kept
    }

    private static func trimmed(_ url: String) -> String {
        url.hasSuffix("/") ? String(url.dropLast()) : url
    }

    /// The review line for the detail view; nil when there's no review to speak of.
    public static func reviewLine(_ pr: PRDetail) -> String? {
        guard let review = pr.pr.review else { return nil }
        switch review.decision {
        case .approved:
            return "Approved"
        case .changes:
            if let who = pr.reviews.last(where: { $0.state == .changes })?.author, !who.isEmpty {
                return "Changes requested by @\(who)"
            }
            return "Changes requested"
        case .waiting:
            if let required = review.required, review.approvals > 0 || required > 1 {
                return "\(review.approvals) of \(required) approvals"
            }
            if let who = pr.requested.first { return "Waiting for review from @\(who)" }
            return "Waiting for review"
        case .none, .unknown:
            return nil
        }
    }
}
