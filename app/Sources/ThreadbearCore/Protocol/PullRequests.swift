import Foundation

// GitHub pull request status (docs/protocol.md, "Pull request status").
// Every enum decodes a value it doesn't know as `.unknown`, and every
// decoder here is lenient, so a newer runner never costs a summary.

/// Anything else the runner sends decodes as `.unknown`.
public enum PRState: String, Sendable, Hashable, Codable {
    case open, draft, merged, closed, unknown

    public init(from decoder: Decoder) throws {
        self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
    }
}

public enum PRChecksState: String, Sendable, Hashable, Codable {
    case passing, failing, running, none, unknown

    public init(from decoder: Decoder) throws {
        self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
    }
}

public enum PRReviewDecision: String, Sendable, Hashable, Codable {
    case approved, changes, waiting, none, unknown

    public init(from decoder: Decoder) throws {
        self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
    }
}

public enum PROutcome: String, Sendable, Hashable, Codable {
    case passed, failed, running, skipped, unknown

    public init(from decoder: Decoder) throws {
        self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
    }
}

public enum PRReviewState: String, Sendable, Hashable, Codable {
    case approved, changes, commented, unknown

    public init(from decoder: Decoder) throws {
        self = Self(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
    }
}

public struct PRChecks: Sendable, Hashable, Codable {
    public var state: PRChecksState
    public var passed: Int
    public var total: Int

    public init(state: PRChecksState, passed: Int = 0, total: Int = 0) {
        self.state = state
        self.passed = passed
        self.total = total
    }

    enum CodingKeys: String, CodingKey { case state, passed, total }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        state = (try? c.decodeIfPresent(PRChecksState.self, forKey: .state)) ?? .unknown
        passed = c.lenientInt(forKey: .passed) ?? 0
        total = c.lenientInt(forKey: .total) ?? 0
    }
}

public struct PRReviewSummary: Sendable, Hashable, Codable {
    public var decision: PRReviewDecision
    public var approvals: Int
    public var required: Int?

    public init(decision: PRReviewDecision, approvals: Int = 0, required: Int? = nil) {
        self.decision = decision
        self.approvals = approvals
        self.required = required
    }

    enum CodingKeys: String, CodingKey { case decision, approvals, required }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        decision = (try? c.decodeIfPresent(PRReviewDecision.self, forKey: .decision)) ?? .unknown
        approvals = c.lenientInt(forKey: .approvals) ?? 0
        required = c.lenientInt(forKey: .required)
    }
}

/// The short form on `ThreadSummary.prs`.
public struct ThreadPR: Sendable, Hashable, Codable, Identifiable {
    public var url: String
    public var repo: String
    public var number: Int
    public var title: String
    public var state: PRState
    public var checks: PRChecks?
    public var review: PRReviewSummary?
    public var conflicts: Bool
    /// When the runner last asked GitHub; nil until it has.
    public var checkedAt: Date?

    public var id: String { url }

    public init(
        url: String, repo: String, number: Int, title: String, state: PRState,
        checks: PRChecks? = nil, review: PRReviewSummary? = nil, conflicts: Bool = false, checkedAt: Date? = nil
    ) {
        self.url = url
        self.repo = repo
        self.number = number
        self.title = title
        self.state = state
        self.checks = checks
        self.review = review
        self.conflicts = conflicts
        self.checkedAt = checkedAt
    }

    enum CodingKeys: String, CodingKey { case url, repo, number, title, state, checks, review, conflicts, checkedAt }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        url = try c.decode(String.self, forKey: .url)
        repo = (try? c.decodeIfPresent(String.self, forKey: .repo)) ?? ""
        number = c.lenientInt(forKey: .number) ?? 0
        title = (try? c.decodeIfPresent(String.self, forKey: .title)) ?? ""
        state = (try? c.decodeIfPresent(PRState.self, forKey: .state)) ?? .unknown
        checks = (try? c.decodeIfPresent(PRChecks.self, forKey: .checks)) ?? nil
        review = (try? c.decodeIfPresent(PRReviewSummary.self, forKey: .review)) ?? nil
        conflicts = ((try? c.decodeIfPresent(Bool.self, forKey: .conflicts)) ?? nil) ?? false
        checkedAt = ((try? c.decodeIfPresent(String.self, forKey: .checkedAt)) ?? nil).flatMap(ISO8601.parse)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(url, forKey: .url)
        try c.encode(repo, forKey: .repo)
        try c.encode(number, forKey: .number)
        try c.encode(title, forKey: .title)
        try c.encode(state, forKey: .state)
        try c.encodeIfPresent(checks, forKey: .checks)
        try c.encodeIfPresent(review, forKey: .review)
        if conflicts { try c.encode(true, forKey: .conflicts) }
        try c.encodeIfPresent(checkedAt.map(ISO8601.format), forKey: .checkedAt)
    }
}

public struct PRCheck: Sendable, Hashable, Codable {
    public var name: String
    public var workflow: String?
    public var outcome: PROutcome
    public var url: String?
    public var seconds: Int?

    public init(name: String, workflow: String? = nil, outcome: PROutcome, url: String? = nil, seconds: Int? = nil) {
        self.name = name
        self.workflow = workflow
        self.outcome = outcome
        self.url = url
        self.seconds = seconds
    }

    enum CodingKeys: String, CodingKey { case name, workflow, outcome, url, seconds }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = (try? c.decodeIfPresent(String.self, forKey: .name)) ?? ""
        workflow = (try? c.decodeIfPresent(String.self, forKey: .workflow)) ?? nil
        outcome = (try? c.decodeIfPresent(PROutcome.self, forKey: .outcome)) ?? .unknown
        url = (try? c.decodeIfPresent(String.self, forKey: .url)) ?? nil
        seconds = c.lenientInt(forKey: .seconds)
    }
}

public struct PRReview: Sendable, Hashable, Codable {
    public var author: String
    public var state: PRReviewState

    public init(author: String, state: PRReviewState) {
        self.author = author
        self.state = state
    }

    enum CodingKeys: String, CodingKey { case author, state }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        author = (try? c.decodeIfPresent(String.self, forKey: .author)) ?? ""
        state = (try? c.decodeIfPresent(PRReviewState.self, forKey: .state)) ?? .unknown
    }
}

/// `threads.prs`: the short form's fields and the extra ones, flat on the wire.
public struct PRDetail: Sendable, Hashable, Codable, Identifiable {
    public var pr: ThreadPR
    public var headRef: String
    public var baseRef: String
    public var checkList: [PRCheck]
    public var reviews: [PRReview]
    /// Logins whose review GitHub is waiting for.
    public var requested: [String]

    public var id: String { pr.url }

    public init(
        pr: ThreadPR, headRef: String = "", baseRef: String = "", checkList: [PRCheck] = [],
        reviews: [PRReview] = [], requested: [String] = []
    ) {
        self.pr = pr
        self.headRef = headRef
        self.baseRef = baseRef
        self.checkList = checkList
        self.reviews = reviews
        self.requested = requested
    }

    enum CodingKeys: String, CodingKey { case headRef, baseRef, checkList, reviews, requested }

    public init(from decoder: Decoder) throws {
        pr = try ThreadPR(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        headRef = (try? c.decodeIfPresent(String.self, forKey: .headRef)) ?? ""
        baseRef = (try? c.decodeIfPresent(String.self, forKey: .baseRef)) ?? ""
        checkList = c.lossyArray(PRCheck.self, forKey: .checkList)
        reviews = c.lossyArray(PRReview.self, forKey: .reviews)
        requested = c.lossyArray(String.self, forKey: .requested)
    }

    public func encode(to encoder: Encoder) throws {
        try pr.encode(to: encoder)
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(headRef, forKey: .headRef)
        try c.encode(baseRef, forKey: .baseRef)
        try c.encode(checkList, forKey: .checkList)
        try c.encode(reviews, forKey: .reviews)
        try c.encode(requested, forKey: .requested)
    }
}

/// The `threads.prs` answer.
struct PRDetailList: Sendable, Decodable {
    var prs: [PRDetail]

    enum CodingKeys: String, CodingKey { case prs }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        prs = c.lossyArray(PRDetail.self, forKey: .prs)
    }
}

public extension RPCClient {
    /// The thread's pull requests with their check lists and reviews, from
    /// the runner's last look (it doesn't ask GitHub again). A runner from
    /// before this answers `-32601`.
    func threadPRs(threadId: String) async throws -> [PRDetail] {
        try await call("threads.prs", .object(["threadId": .string(threadId)]), as: PRDetailList.self).prs
    }
}
