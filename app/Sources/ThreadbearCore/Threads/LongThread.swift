import Foundation

/// The card by the composer once a thread's conversation is long (protocol
/// "Long threads"): the runner says when it's past runner.json's levels
/// (contextLong), and this decides what the card shows. Every model call
/// re-reads the whole conversation, so a long one costs more each turn
/// and the model keeps track of early details less well.
public enum LongThread: Equatable, Sendable {
    /// Past a level: Compact, Continue in a new thread or Not now.
    case suggest(firm: Bool, tokens: Int)
    /// Continue in a new thread's handoff is being written.
    case writing
    /// It carried on in another thread.
    case continued(ContinuedIn)

    /// How far along: what Not now hides, up to and including.
    var rank: Int {
        switch self {
        case .suggest(let firm, _): firm ? 2 : 1
        case .writing: 0
        case .continued: 3
        }
    }

    /// Not now: the card stays hidden for the thread up to this rank, while
    /// its context hasn't dropped below what it was (a compact voids it).
    public struct Dismissal: Codable, Equatable, Sendable {
        public var rank: Int
        public var tokens: Int

        public init(rank: Int, tokens: Int) {
            self.rank = rank
            self.tokens = tokens
        }
    }

    /// The card for `thread`, if any. Only between turns, apart from the
    /// handoff the click started.
    public static func card(for thread: ThreadSummary, dismissed: Dismissal?) -> LongThread? {
        if thread.sample { return nil }
        if thread.continuing { return .writing }
        if thread.status.isBusy { return nil }
        let card: LongThread
        if let next = thread.continuedIn {
            card = .continued(next)
        } else if let long = thread.contextLong, long == "gentle" || long == "firm", let tokens = thread.contextTokens {
            card = .suggest(firm: long == "firm", tokens: tokens)
        } else {
            return nil
        }
        if let dismissed, dismissed.rank >= card.rank, (thread.contextTokens ?? 0) >= dismissed.tokens { return nil }
        return card
    }

    /// What Not now on this card records.
    public func dismissal(tokens: Int?) -> Dismissal {
        Dismissal(rank: rank, tokens: tokens ?? 0)
    }

    /// The card's words.
    public var message: String {
        switch self {
        case .suggest(false, let tokens):
            "This conversation is long (\(ContextMeter.tokens(tokens)) tokens). Every reply re-reads all of it, so each one costs more and early details get harder to keep track of."
        case .suggest(true, let tokens):
            "This conversation is very long (\(ContextMeter.tokens(tokens)) tokens). Compact it or carry on in a new thread to make replies cheaper and sharper."
        case .writing:
            "Writing a handoff for the new thread…"
        case .continued(let next):
            "Carried on in \u{201C}\(next.title)\u{201D}."
        }
    }
}
