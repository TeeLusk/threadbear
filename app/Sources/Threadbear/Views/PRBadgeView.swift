import SwiftUI
import ThreadbearCore

/// A thread's pull requests on its sidebar row: one icon in the colour of
/// the PR that most needs attention, and how many when there's more than
/// one (docs/pr-status-design, "The sidebar badge").
struct PRBadgeView: View {
    let prs: [ThreadPR]

    var body: some View {
        if let tone = PRBadge.tone(prs) {
            let side = TypeScale.sidebarMeta + 2
            HStack(spacing: zoomed(3)) {
                Image(nsImage: PRIcon.image(PRIcon.forTone(tone), side: side))
                    .renderingMode(.template)
                    .resizable()
                    .frame(width: side, height: side)
                    .foregroundStyle(tone.color)
                if prs.count >= 2 {
                    Text("\(prs.count)")
                        .font(.system(size: TypeScale.sidebarMeta))
                        .monospacedDigit()
                        .foregroundStyle(SidebarMetrics.faint)
                }
            }
            .tip(PRBadge.tooltip(prs))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(PRBadge.tooltip(prs))
        }
    }
}
