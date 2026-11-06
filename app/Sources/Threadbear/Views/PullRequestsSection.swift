import AppKit
import SwiftUI
import ThreadbearCore

extension HighlightFold {
    static let pullRequests = "pullRequests"
}

/// The thread's pull requests at the top of its Highlights, a card each
/// (docs/pr-status-design, "The side pane"): the PR, its checks (open when
/// one has failed), its review, conflicts, and when the runner last looked.
/// The check lists come from `threads.prs`, asked again after each look;
/// until it answers, or from a runner that doesn't know it, the cards show
/// what the summary has.
struct PullRequestsSection: View {
    @Environment(AppModel.self) private var app
    let thread: ThreadSummary
    /// The runner's last answer, by URL.
    @State private var details: [String: PRDetail] = [:]

    var body: some View {
        let folded = app.collapsedHighlights.contains(HighlightFold.pullRequests)
        VStack(alignment: .leading, spacing: 0) {
            SectionHeading(title: "Pull requests", icon: "arrow.triangle.pull", fold: fold(folded))
            if !folded {
                VStack(alignment: .leading, spacing: zoomed(8)) {
                    ForEach(cards) { PullRequestCard(detail: $0, thread: thread) }
                }
            }
        }
        // thread.prs moves on with every look (checkedAt), so the check
        // lists are asked for again each time.
        .task(id: thread.prs) { await fetch() }
    }

    /// The summary's PRs, newest first, with what the runner's answer adds.
    private var cards: [PRDetail] {
        thread.prs.map { pr in
            var detail = details[pr.url] ?? PRDetail(pr: pr)
            detail.pr = pr
            return detail
        }
    }

    private func fold(_ folded: Bool) -> SectionFold {
        .init(collapsed: folded, count: thread.prs.count) {
            withAnimation(.snappy(duration: 0.2)) {
                if folded {
                    app.collapsedHighlights.remove(HighlightFold.pullRequests)
                } else {
                    app.collapsedHighlights.insert(HighlightFold.pullRequests)
                }
            }
        }
    }

    private func fetch() async {
        guard let client = app.client(for: thread.id) else { return }
        do {
            let fresh = try await client.threadPRs(threadId: thread.id)
            if Task.isCancelled { return }
            details = Dictionary(fresh.map { ($0.pr.url, $0) }, uniquingKeysWith: { first, _ in first })
        } catch RPCError.server(let code, _) where code == RPCError.methodNotFound {
            // An older runner: the summary's lines, no check lists.
        } catch {
            AppLog.write("rpc", "threads.prs failed: \(error.localizedDescription)")
        }
    }
}

/// One pull request: its title (a click opens it), `widgets #683 · Open`
/// under it and a ••• menu, then its checks, review, conflicts, and when
/// it was last looked at.
private struct PullRequestCard: View {
    @Environment(AppModel.self) private var app
    let detail: PRDetail
    let thread: ThreadSummary
    /// Mike's own open or shut; until then, open when a check has failed.
    @State private var checksOpen: Bool?
    /// The look "Fix failing checks" was sent on, so it can't go twice
    /// before the runner has looked again.
    @State private var fixSentOn: String?

    private var pr: ThreadPR { detail.pr }
    private var failing: Bool { pr.checks?.state == .failing }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            checks
            if let review = PRBadge.reviewLine(detail) {
                PaneRow(icon: reviewIcon, iconColor: reviewColor, title: review, titleTruncation: .tail)
            }
            if pr.conflicts {
                PaneRow(icon: "exclamationmark.triangle", iconColor: PRPalette.red,
                        title: "Merge conflicts with \(detail.baseRef.isEmpty ? "the base branch" : detail.baseRef)",
                        titleTruncation: .tail)
                    .foregroundStyle(PRPalette.red)
            }
            TimelineView(.periodic(from: .now, by: 10)) { context in
                Text(PRBadge.checkedLine(pr.checkedAt, now: context.date))
                    .font(.system(size: TypeScale.small))
                    .foregroundStyle(SidebarMetrics.faint)
            }
            .padding(.leading, SidebarMetrics.leading + zoomed(24))
            .padding(.top, zoomed(2))
            .padding(.bottom, zoomed(6))
        }
        .padding(.vertical, zoomed(4))
        .background(RoundedRectangle(cornerRadius: zoomed(10)).fill(Color.primary.opacity(0.035)))
        .overlay(RoundedRectangle(cornerRadius: zoomed(10)).strokeBorder(Color(nsColor: Theme.cardBorder), lineWidth: 0.5))
        .padding(.horizontal, SidebarMetrics.outerInset)
    }

    private var header: some View {
        let tone = PRBadge.tone([pr]) ?? .draft
        return HStack(alignment: .center, spacing: 0) {
            PaneRow(iconImage: PRIcon.image(PRIcon.forState(pr.state), side: 16), iconColor: tone.color,
                    title: pr.title.isEmpty ? "#\(pr.number)" : pr.title, detail: PRBadge.subtitle(pr),
                    titleTruncation: .tail, detailTruncation: .tail) {
                open()
            }
            .tip("Open \(pr.repo) #\(pr.number)")
            .iconContextMenu { menuItems }
            IconMenu { menuItems } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: TypeScale.label, weight: .medium))
                    .foregroundStyle(.secondary)
                    .frame(width: zoomed(24), height: zoomed(24))
                    .contentShape(Rectangle())
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .menuIndicator(.hidden)
            .fixedSize()
            .tip("More")
            .padding(.trailing, SidebarMetrics.outerInset)
        }
    }

    @ViewBuilder
    private var menuItems: some View {
        if let url = PRBadge.webLink(pr.url) {
            Button("Open on GitHub", systemImage: "arrow.up.forward") { app.openExternally(url) }
        }
        Button("Copy link", systemImage: "link") { app.copyToPasteboard(pr.url) }
        if failing {
            Divider()
            if fixSent {
                Button("Asked the thread to fix them", systemImage: "checkmark") {}
                    .disabled(true)
            } else {
                Button("Fix failing checks", systemImage: "wrench.and.screwdriver") {
                    // Shown as asked straight away; back to the button if
                    // the runner doesn't take it (the error says why).
                    let sentOn = look
                    fixSentOn = sentOn
                    let sent = app.send(PRBadge.fixChecksPrompt(pr.url), to: thread.id) {
                        if fixSentOn == sentOn { fixSentOn = nil }
                    }
                    if !sent { fixSentOn = nil }
                }
            }
        }
    }

    /// Sent since the runner last looked: the next look shows whether it helped.
    private var fixSent: Bool { fixSentOn == look }

    private var look: String { pr.checkedAt.map(ISO8601.format) ?? "" }

    @ViewBuilder
    private var checks: some View {
        if let line = PRBadge.checksLine(pr) {
            let list = PRBadge.sortedChecks(detail.checkList)
            let open = !list.isEmpty && (checksOpen ?? failing)
            PaneRow(icon: list.isEmpty ? nil : open ? "chevron.down" : "chevron.right", title: line,
                    quiet: true, reservesIcon: true,
                    action: list.isEmpty ? nil : { withAnimation(.easeOut(duration: 0.15)) { checksOpen = !open } })
                .tip(list.isEmpty ? line : open ? "Hide the checks" : "Show each check")
            if open {
                ForEach(Array(list.enumerated()), id: \.offset) { _, check in checkRow(check) }
            }
        }
    }

    private func checkRow(_ check: PRCheck) -> some View {
        let shape = PRIcon.forOutcome(check.outcome)
        let link = PRBadge.webLink(check.url)
        let word = outcomeWord(check.outcome)
        return PaneRow(iconImage: shape.map { PRIcon.image($0, side: 16) }, iconColor: outcomeColor(check.outcome),
                       title: check.name, trailing: PRBadge.checkTrailing(check),
                       detail: check.workflow, indent: true, reservesIcon: true,
                       titleTruncation: .tail, detailTruncation: .tail,
                       action: link.map { url in { app.openLink(url, title: check.name, in: thread) } })
            .tip(link == nil ? word : "\(word). Click to open its run.")
            .accessibilityElement(children: .combine)
            .accessibilityLabel([check.name, word, check.workflow].compactMap { $0 }.joined(separator: ", "))
    }

    private func outcomeColor(_ outcome: PROutcome) -> Color {
        switch outcome {
        case .passed: PRPalette.green
        case .failed: PRPalette.red
        case .running: PRPalette.amber
        case .skipped, .unknown: PRPalette.grey
        }
    }

    private func outcomeWord(_ outcome: PROutcome) -> String {
        switch outcome {
        case .passed: "Passed"
        case .failed: "Failed"
        case .running: "Running"
        case .skipped: "Skipped"
        case .unknown: "Not known"
        }
    }

    private var reviewIcon: String {
        switch pr.review?.decision {
        case .approved: "checkmark.bubble"
        case .changes: "exclamationmark.bubble"
        default: "eye"
        }
    }

    private var reviewColor: Color? {
        switch pr.review?.decision {
        case .approved: PRPalette.green
        case .changes: PRPalette.red
        default: nil
        }
    }

    private func open() {
        guard let url = PRBadge.webLink(pr.url) else { return }
        app.openLink(url, title: pr.title, in: thread)
    }
}
