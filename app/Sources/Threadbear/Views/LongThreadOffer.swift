import Observation
import SwiftUI
import ThreadbearCore

/// Not now on the long thread card, per thread, kept on this Mac
/// (LongThread.Dismissal). In a file of its own, not AppModel, so the
/// feature stays in one place for a fork bringing in Mike's releases.
@MainActor @Observable
final class LongThreadDismissals {
    static let shared = LongThreadDismissals()
    static let key = "longThreadDismissals"

    private(set) var byThread: [String: LongThread.Dismissal]

    init(defaults: UserDefaults = .standard) {
        let data = defaults.data(forKey: Self.key)
        byThread = data.flatMap { try? JSONDecoder().decode([String: LongThread.Dismissal].self, from: $0) } ?? [:]
    }

    func dismiss(_ threadId: String, _ dismissal: LongThread.Dismissal) {
        byThread[threadId] = dismissal
        // A few hundred bytes a thread; the oldest threads' don't matter.
        if byThread.count > 500 { byThread.remove(at: byThread.startIndex) }
        if let data = try? JSONEncoder().encode(byThread) { UserDefaults.standard.set(data, forKey: Self.key) }
    }
}

enum LongThreadBusy {
    static func compact(_ threadId: String) -> String { "longCompact/\(threadId)" }
    static func continueFresh(_ threadId: String) -> String { "longContinue/\(threadId)" }
}

extension AppModel {
    func compactLongThread(_ threadId: String) {
        whileBusy(LongThreadBusy.compact(threadId)) { [self] in
            guard let client = client(for: threadId) else { return }
            do {
                _ = try await client.send(threadId: threadId, text: "/compact")
            } catch {
                show(error)
            }
        }
    }

    func continueLongThread(_ threadId: String) {
        whileBusy(LongThreadBusy.continueFresh(threadId)) { [self] in
            guard let client = client(for: threadId) else { return }
            do {
                _ = try await client.continueFresh(threadId: threadId)
            } catch {
                show(error)
            }
        }
    }
}

/// The long thread card, above the message box like RefusalOffer.
struct LongThreadOffer: View {
    @Environment(AppModel.self) private var app
    let thread: ThreadSummary
    private var dismissals: LongThreadDismissals { .shared }

    var body: some View {
        if let card = LongThread.card(for: thread, dismissed: dismissals.byThread[thread.id]) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: zoomed(12)) {
                    message(card)
                    Spacer(minLength: 0)
                    buttons(card)
                }
                VStack(alignment: .leading, spacing: zoomed(8)) {
                    message(card)
                    buttons(card)
                }
            }
            .font(.system(size: TypeScale.label))
            .padding(zoomed(12))
            .background(Color(nsColor: Theme.cardBackground), in: RoundedRectangle(cornerRadius: zoomed(12)))
            .overlay { RoundedRectangle(cornerRadius: zoomed(12)).stroke(Color(nsColor: Theme.hairline), lineWidth: 0.5) }
            .padding(.bottom, zoomed(8))
        }
    }

    private func message(_ card: LongThread) -> some View {
        Text(card.message)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private func buttons(_ card: LongThread) -> some View {
        HStack(spacing: zoomed(8)) {
            switch card {
            case .suggest:
                let compacting = app.isBusy(LongThreadBusy.compact(thread.id))
                let continuing = app.isBusy(LongThreadBusy.continueFresh(thread.id))
                Button(compacting ? "Compacting…" : "Compact") { app.compactLongThread(thread.id) }
                    .busy(compacting || continuing)
                    .tip("Send /compact: the agent sums up the conversation so far and carries on from the summary")
                Button(continuing ? "Starting…" : "Continue in a new thread") { app.continueLongThread(thread.id) }
                    .busy(compacting || continuing)
                    .tip("Ask the agent for a short handoff, then start a new thread with it in this folder, on the same model and pool")
                notNow(card)
            case .writing:
                ProgressView().controlSize(.small)
            case .continued(let next):
                Button("Open") { app.select(next.threadId) }
                    .tip("Go to the thread this one carried on in")
                notNow(card)
            }
        }
        .fixedSize()
    }

    private func notNow(_ card: LongThread) -> some View {
        Button("Not now") { dismissals.dismiss(thread.id, card.dismissal(tokens: thread.contextTokens)) }
            .tip("Hide this for this thread until it gets longer still")
    }
}
