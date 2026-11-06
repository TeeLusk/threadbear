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
