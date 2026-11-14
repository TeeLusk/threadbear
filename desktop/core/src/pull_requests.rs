//! GitHub pull request status (docs/protocol.md, "Pull request status"): the
//! short form on each summary (`ThreadSummary.prs`), the detail
//! `threads.prs` answers, and what the sidebar badge and the Highlights
//! cards say about them. A port of the Swift app's `PullRequests.swift` and
//! `PRBadge.swift`. Every value it doesn't know reads as `Unknown`, and a
//! PR it can't read is left out, so a newer runner never costs a summary.
use crate::highlights::{is_web_page, Highlight, HighlightKind, ThreadHighlights};
use chrono::{DateTime, TimeZone};
use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PrState { Open, Draft, Merged, Closed, Unknown }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChecksState { Passing, Failing, Running, None, Unknown }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReviewDecision { Approved, Changes, Waiting, None, Unknown }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome { Passed, Failed, Running, Skipped, Unknown }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReviewState { Approved, Changes, Commented, Unknown }

fn word(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or("").to_owned()
}

fn opt_word(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(str::to_owned)
}

/// A whole number, or one sent as a float or a string (`lenientInt`).
fn int(v: &Value, key: &str) -> Option<i64> {
    let n = v.get(key)?;
    n.as_i64().or_else(|| n.as_f64().filter(|f| f.fract() == 0. && f.abs() < crate::reducer::format::MAX_SAFE_INTEGER).map(|f| f as i64)).or_else(|| n.as_str().and_then(|s| s.parse().ok()))
}

fn strings(v: &Value, key: &str) -> Vec<String> {
    v.get(key).and_then(Value::as_array).into_iter().flatten().filter_map(|s| s.as_str().map(str::to_owned)).collect()
}

impl PrState {
    fn parse(s: &str) -> Self {
        match s { "open" => Self::Open, "draft" => Self::Draft, "merged" => Self::Merged, "closed" => Self::Closed, _ => Self::Unknown }
    }
}
impl ChecksState {
    fn parse(s: &str) -> Self {
        match s { "passing" => Self::Passing, "failing" => Self::Failing, "running" => Self::Running, "none" => Self::None, _ => Self::Unknown }
    }
}
impl ReviewDecision {
    fn parse(s: &str) -> Self {
        match s { "approved" => Self::Approved, "changes" => Self::Changes, "waiting" => Self::Waiting, "none" => Self::None, _ => Self::Unknown }
    }
}
impl Outcome {
    fn parse(s: &str) -> Self {
        match s { "passed" => Self::Passed, "failed" => Self::Failed, "running" => Self::Running, "skipped" => Self::Skipped, _ => Self::Unknown }
    }
}
impl ReviewState {
    fn parse(s: &str) -> Self {
        match s { "approved" => Self::Approved, "changes" => Self::Changes, "commented" => Self::Commented, _ => Self::Unknown }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Checks { pub state: ChecksState, pub passed: i64, pub total: i64 }

#[derive(Clone, Debug, PartialEq)]
pub struct ReviewSummary { pub decision: ReviewDecision, pub approvals: i64, pub required: Option<i64> }

/// The short form on a summary (`ThreadPR`).
#[derive(Clone, Debug, PartialEq)]
pub struct ThreadPr {
    pub url: String,
    pub repo: String,
    pub number: i64,
    pub title: String,
    pub state: PrState,
    pub checks: Option<Checks>,
    pub review: Option<ReviewSummary>,
    pub conflicts: bool,
    /// When the runner last asked GitHub, in ms; none until it has.
    pub checked_at: Option<i64>,
    /// As it came, so a change in any field is a new look (`checkedAt`).
    pub checked_at_text: Option<String>,
}

impl ThreadPr {
    /// None for one with no url, which is how a PR is known.
    pub fn decode(v: &Value) -> Option<ThreadPr> {
        let url = v.get("url")?.as_str()?.to_owned();
        let checks = v.get("checks").filter(|c| c.is_object()).map(|c| Checks {
            state: ChecksState::parse(&word(c, "state")),
            passed: int(c, "passed").unwrap_or(0),
            total: int(c, "total").unwrap_or(0),
        });
        let review = v.get("review").filter(|r| r.is_object()).map(|r| ReviewSummary {
            decision: ReviewDecision::parse(&word(r, "decision")),
            approvals: int(r, "approvals").unwrap_or(0),
            required: int(r, "required"),
        });
        let checked_at_text = opt_word(v, "checkedAt");
        Some(ThreadPr {
            url,
            repo: word(v, "repo"),
            number: int(v, "number").unwrap_or(0),
            title: word(v, "title"),
            state: PrState::parse(&word(v, "state")),
            checks,
            review,
            conflicts: v.get("conflicts").and_then(Value::as_bool).unwrap_or(false),
            checked_at: checked_at_text.as_deref().and_then(crate::inbox::parse_ms),
            checked_at_text,
        })
    }

    /// A summary's `prs`, leaving out any it can't read.
    pub fn list(prs: Option<&[Value]>) -> Vec<ThreadPr> {
        prs.into_iter().flatten().filter_map(ThreadPr::decode).collect()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Check { pub name: String, pub workflow: Option<String>, pub outcome: Outcome, pub url: Option<String>, pub seconds: Option<i64> }

impl Check {
    pub fn new(name: &str, outcome: Outcome) -> Check {
        Check { name: name.into(), workflow: None, outcome, url: None, seconds: None }
    }

    fn decode(v: &Value) -> Option<Check> {
        v.is_object().then(|| Check {
            name: word(v, "name"),
            workflow: opt_word(v, "workflow"),
            outcome: Outcome::parse(&word(v, "outcome")),
            url: opt_word(v, "url"),
            seconds: int(v, "seconds"),
        })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Review { pub author: String, pub state: ReviewState }

/// One of `threads.prs`'s answers: the short form's fields and these, flat
/// on the wire (`PRDetail`).
#[derive(Clone, Debug, PartialEq)]
pub struct PrDetail {
    pub pr: ThreadPr,
    pub head_ref: String,
    pub base_ref: String,
    pub check_list: Vec<Check>,
    pub reviews: Vec<Review>,
    /// Logins whose review GitHub is waiting for.
    pub requested: Vec<String>,
}

impl PrDetail {
    /// What the summary alone says, before `threads.prs` has answered.
    pub fn of(pr: ThreadPr) -> PrDetail {
        PrDetail { pr, head_ref: String::new(), base_ref: String::new(), check_list: vec![], reviews: vec![], requested: vec![] }
    }

    pub fn decode(v: &Value) -> Option<PrDetail> {
        Some(PrDetail {
            pr: ThreadPr::decode(v)?,
            head_ref: word(v, "headRef"),
            base_ref: word(v, "baseRef"),
            check_list: v.get("checkList").and_then(Value::as_array).into_iter().flatten().filter_map(Check::decode).collect(),
            reviews: v.get("reviews").and_then(Value::as_array).into_iter().flatten().filter(|r| r.is_object()).map(|r| Review { author: word(r, "author"), state: ReviewState::parse(&word(r, "state")) }).collect(),
            requested: strings(v, "requested"),
        })
    }

    /// The `threads.prs` answer.
    pub fn list(answer: &Value) -> Vec<PrDetail> {
        answer.get("prs").and_then(Value::as_array).into_iter().flatten().filter_map(PrDetail::decode).collect()
    }
}

/// What a thread's pull requests add up to, for the sidebar badge.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tone { Failing, Running, Open, Draft, Merged, Closed }

/// A PR the runner hasn't looked at yet, or one in a state this app doesn't
/// know, reads as grey like a draft.
fn effective_state(pr: &ThreadPr) -> PrState {
    if pr.checked_at_text.is_none() || pr.state == PrState::Unknown { PrState::Draft } else { pr.state }
}

fn checks_state(pr: &ThreadPr) -> Option<ChecksState> {
    pr.checks.as_ref().map(|c| c.state)
}

fn is_failing(pr: &ThreadPr) -> bool {
    effective_state(pr) == PrState::Open
        && (checks_state(pr) == Some(ChecksState::Failing) || pr.conflicts || pr.review.as_ref().map(|r| r.decision) == Some(ReviewDecision::Changes))
}

/// Worst first: failing, running, open, draft, merged, closed. None for none.
pub fn tone(prs: &[ThreadPr]) -> Option<Tone> {
    if prs.is_empty() {
        return None;
    }
    if prs.iter().any(is_failing) {
        return Some(Tone::Failing);
    }
    if prs.iter().any(|p| effective_state(p) == PrState::Open && checks_state(p) == Some(ChecksState::Running)) {
        return Some(Tone::Running);
    }
    let states: Vec<PrState> = prs.iter().map(effective_state).collect();
    Some(if states.contains(&PrState::Open) {
        Tone::Open
    } else if states.contains(&PrState::Draft) {
        Tone::Draft
    } else if states.contains(&PrState::Merged) {
        Tone::Merged
    } else {
        Tone::Closed
    })
}

/// "2 pull requests: #683 checks failing, #681 merged".
pub fn tooltip(prs: &[ThreadPr]) -> String {
    if prs.is_empty() {
        return String::new();
    }
    let head = if prs.len() == 1 { "1 pull request".to_owned() } else { format!("{} pull requests", prs.len()) };
    format!("{head}: {}", prs.iter().map(|p| format!("#{} {}", p.number, phrase(p))).collect::<Vec<_>>().join(", "))
}

fn phrase(pr: &ThreadPr) -> &'static str {
    match effective_state(pr) {
        PrState::Merged => "merged",
        PrState::Closed => "closed",
        PrState::Draft => if pr.state == PrState::Draft { "draft" } else { "not checked yet" },
        _ => {
            let checks = checks_state(pr);
            if checks == Some(ChecksState::Failing) {
                "checks failing"
            } else if pr.conflicts {
                "has conflicts"
            } else if pr.review.as_ref().map(|r| r.decision) == Some(ReviewDecision::Changes) {
                "changes requested"
            } else if checks == Some(ChecksState::Running) {
                "checks running"
            } else if checks == Some(ChecksState::Passing) {
                "checks passing"
            } else {
                "open"
            }
        }
    }
}

/// Under a card's title: "widgets #683 · Merged". The repo's name without
/// its owner, as GitHub's own lists show it. No state word for a PR never
/// fetched: the runner's state for it is a placeholder, and the card's
/// footer says "Not checked yet".
pub fn subtitle(pr: &ThreadPr) -> String {
    let name = pr.repo.rsplit('/').next().unwrap_or(&pr.repo);
    let head = if name.is_empty() { format!("#{}", pr.number) } else { format!("{name} #{}", pr.number) };
    if pr.checked_at_text.is_none() {
        return head;
    }
    let word = match pr.state {
        PrState::Open => "Open",
        PrState::Draft => "Draft",
        PrState::Merged => "Merged",
        PrState::Closed => "Closed",
        PrState::Unknown => return head,
    };
    format!("{head} · {word}")
}

/// "Checks · 12 of 13 passed"; none when the PR has no checks.
pub fn checks_line(pr: &ThreadPr) -> Option<String> {
    let checks = pr.checks.as_ref().filter(|c| c.total > 0)?;
    Some(format!("Checks · {} of {} passed", checks.passed, checks.total))
}

/// Failed first, then running, passed and skipped, each kept in the
/// runner's order.
pub fn sorted_checks(checks: &[Check]) -> Vec<Check> {
    let rank = |o: Outcome| match o {
        Outcome::Failed => 0,
        Outcome::Running => 1,
        Outcome::Passed => 2,
        Outcome::Skipped => 3,
        Outcome::Unknown => 4,
    };
    let mut sorted = checks.to_vec();
    // Stable, so each rank keeps the runner's order.
    sorted.sort_by_key(|c| rank(c.outcome));
    sorted
}

/// A check row's trailing text: how long it took, or "skipped" for a skipped
/// one, whose start and end times GitHub still gives.
pub fn check_trailing(check: &Check) -> Option<String> {
    if check.outcome == Outcome::Skipped {
        return Some("skipped".into());
    }
    check.seconds.map(|s| crate::reducer::format::duration(s as f64 * 1000.))
}

/// A check's outcome in a word, for its tooltip.
pub fn outcome_word(outcome: Outcome) -> &'static str {
    match outcome {
        Outcome::Passed => "Passed",
        Outcome::Failed => "Failed",
        Outcome::Running => "Running",
        Outcome::Skipped => "Skipped",
        Outcome::Unknown => "Not known",
    }
}

/// A PR's or check's link as something to open, only when it's a web page:
/// these come from GitHub, and a check's from whoever set it up.
pub fn web_link(text: Option<&str>) -> Option<&str> {
    text.filter(|t| is_web_page(t))
}

/// "Checked 40s ago", so a stale card says it's stale.
pub fn checked_line<Tz: TimeZone>(checked_at: Option<i64>, now: &DateTime<Tz>) -> String {
    let Some(at) = checked_at else { return "Not checked yet".into() };
    let seconds = ((now.timestamp_millis() - at) / 1000).max(0);
    if seconds < 10 {
        "Checked just now".into()
    } else if seconds < 60 {
        format!("Checked {}s ago", seconds / 10 * 10)
    } else if seconds < 86_400 {
        format!("Checked {} ago", crate::sidebar::relative_short(at, now))
    } else {
        format!("Checked {}", crate::sidebar::relative_short(at, now))
    }
}

/// Whether a card offers "Fix failing checks": not on a merged or closed PR,
/// which a push can't help.
pub fn can_fix_checks(pr: &ThreadPr) -> bool {
    checks_state(pr) == Some(ChecksState::Failing) && matches!(pr.state, PrState::Open | PrState::Draft)
}

/// What "Fix failing checks" sends the thread, naming the PR, as a thread
/// can have several.
pub fn fix_checks_prompt(url: &str) -> String {
    format!("This pull request's checks are failing: {url}. Look with `gh pr checks {url}` and `gh run view <run-id> --log-failed`, find the cause, fix it, and push. Tell me if a failure isn't from this branch's changes.")
}

/// The highlights without the PR links the Pull requests section already
/// shows, so a PR isn't listed twice. A pinned one stays: it was pinned on
/// purpose and may have a note.
pub fn without_tracked(highlights: &ThreadHighlights, prs: &[ThreadPr]) -> ThreadHighlights {
    if prs.is_empty() {
        return highlights.clone();
    }
    let trimmed = |u: &str| u.strip_suffix('/').unwrap_or(u).to_owned();
    let tracked: std::collections::HashSet<String> = prs.iter().map(|p| trimmed(&p.url)).collect();
    let mut kept = highlights.clone();
    kept.highlights.retain(|item: &Highlight| !(item.kind == HighlightKind::Pr && !item.is_pinned() && item.url.as_deref().is_some_and(|u| tracked.contains(&trimmed(u)))));
    kept
}

/// The review line for a card; none when there's no review to speak of.
pub fn review_line(pr: &PrDetail) -> Option<String> {
    let review = pr.pr.review.as_ref()?;
    match review.decision {
        ReviewDecision::Approved => Some("Approved".into()),
        ReviewDecision::Changes => Some(match pr.reviews.iter().rev().find(|r| r.state == ReviewState::Changes).map(|r| r.author.as_str()).filter(|a| !a.is_empty()) {
            Some(who) => format!("Changes requested by @{who}"),
            None => "Changes requested".into(),
        }),
        ReviewDecision::Waiting => {
            if let Some(required) = review.required.filter(|r| review.approvals > 0 || *r > 1) {
                return Some(format!("{} of {required} approvals", review.approvals));
            }
            Some(match pr.requested.first() {
                Some(who) => format!("Waiting for review from @{who}"),
                None => "Waiting for review".into(),
            })
        }
        ReviewDecision::None | ReviewDecision::Unknown => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn pr(number: i64, state: PrState, checks: Option<ChecksState>, review: Option<ReviewDecision>, conflicts: bool, checked: bool) -> ThreadPr {
        ThreadPr {
            url: format!("https://github.com/acme/widgets/pull/{number}"),
            repo: "acme/widgets".into(),
            number,
            title: format!("PR {number}"),
            state,
            checks: checks.map(|state| Checks { state, passed: 1, total: 2 }),
            review: review.map(|decision| ReviewSummary { decision, approvals: 0, required: None }),
            conflicts,
            checked_at: checked.then_some(1_000),
            checked_at_text: checked.then(|| "2026-11-06T10:00:00Z".into()),
        }
    }

    fn open(n: i64) -> ThreadPr { pr(n, PrState::Open, None, None, false, true) }
    fn with_state(n: i64, s: PrState) -> ThreadPr { pr(n, s, None, None, false, true) }
    fn with_checks(n: i64, s: PrState, c: ChecksState) -> ThreadPr { pr(n, s, Some(c), None, false, true) }

    fn summary(v: Value) -> crate::inbox::ThreadSummary {
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn decodes_summary_without_prs() {
        assert!(summary(json!({"id": "t1", "title": "x"})).prs().is_empty());
    }

    #[test]
    fn malformed_prs_decode_to_empty() {
        let s = summary(json!({"id": "t1", "title": "x", "prs": "nope"}));
        assert!(s.prs().is_empty());
        assert_eq!(s.title, "x");
    }

    #[test]
    fn decodes_prs() {
        let s = summary(json!({"id": "t1", "title": "x", "prs": [{"url": "https://github.com/acme/widgets/pull/7", "repo": "acme/widgets", "number": 7,
            "title": "Add", "state": "open", "checks": {"state": "failing", "passed": 1, "total": 3},
            "review": {"decision": "changes", "approvals": 0, "required": 2}, "conflicts": true, "checkedAt": "2026-11-06T10:00:00Z"}, {"title": "no url"}]}));
        let prs = s.prs();
        assert_eq!(prs.len(), 1);
        assert_eq!(prs[0].checks.as_ref().unwrap().state, ChecksState::Failing);
        assert_eq!(prs[0].review.as_ref().unwrap().required, Some(2));
        assert!(prs[0].conflicts);
        assert_eq!(prs[0].checked_at, crate::inbox::parse_ms("2026-11-06T10:00:00Z"));
    }

    #[test]
    fn unknown_state_decodes() {
        let s = summary(json!({"id": "t1", "title": "x", "prs": [{"url": "u", "repo": "a/b", "number": 1, "title": "t", "state": "queued",
            "checks": {"state": "weird", "passed": 0, "total": 0}, "checkedAt": "2026-11-06T10:00:00Z"}]}));
        let prs = s.prs();
        assert_eq!(prs[0].state, PrState::Unknown);
        assert_eq!(prs[0].checks.as_ref().unwrap().state, ChecksState::Unknown);
        assert_eq!(tone(&prs), Some(Tone::Draft));
    }

    #[test]
    fn detail_decodes() {
        let list = PrDetail::list(&json!({"prs": [{"url": "u", "repo": "a/b", "number": 1, "title": "t", "state": "open", "headRef": "h", "baseRef": "main",
            "checkList": [{"name": "build", "outcome": "failed", "seconds": 12}, {"name": "x", "outcome": "odd"}],
            "reviews": [{"author": "x", "state": "changes"}], "requested": ["y"]}]}));
        assert_eq!(list[0].check_list.iter().map(|c| c.outcome).collect::<Vec<_>>(), vec![Outcome::Failed, Outcome::Unknown]);
        assert_eq!(list[0].requested, vec!["y"]);
        assert_eq!(list[0].pr.number, 1);
        assert_eq!(list[0].base_ref, "main");
    }

    #[test]
    fn tone_order() {
        assert_eq!(tone(&[with_state(1, PrState::Merged), with_checks(2, PrState::Open, ChecksState::Failing)]), Some(Tone::Failing));
        assert_eq!(tone(&[pr(1, PrState::Open, None, None, true, true)]), Some(Tone::Failing));
        assert_eq!(tone(&[pr(1, PrState::Open, None, Some(ReviewDecision::Changes), false, true)]), Some(Tone::Failing));
        assert_eq!(tone(&[with_state(1, PrState::Merged), with_checks(2, PrState::Open, ChecksState::Running)]), Some(Tone::Running));
        assert_eq!(tone(&[with_checks(1, PrState::Open, ChecksState::Passing)]), Some(Tone::Open));
        assert_eq!(tone(&[with_state(1, PrState::Merged), with_state(2, PrState::Merged)]), Some(Tone::Merged));
        assert_eq!(tone(&[with_state(1, PrState::Closed)]), Some(Tone::Closed));
        assert_eq!(tone(&[with_state(1, PrState::Draft)]), Some(Tone::Draft));
        assert_eq!(tone(&[pr(1, PrState::Open, None, None, false, false)]), Some(Tone::Draft));
        assert_eq!(tone(&[]), None);
    }

    #[test]
    fn tooltips() {
        let prs = [with_checks(683, PrState::Open, ChecksState::Failing), with_state(681, PrState::Merged)];
        assert_eq!(tooltip(&prs), "2 pull requests: #683 checks failing, #681 merged");
        assert_eq!(tooltip(&[with_checks(5, PrState::Open, ChecksState::Passing)]), "1 pull request: #5 checks passing");
        assert_eq!(tooltip(&[pr(6, PrState::Open, None, None, false, false)]), "1 pull request: #6 not checked yet");
    }

    fn detail(review: Option<ReviewSummary>, reviews: Vec<Review>, requested: Vec<&str>) -> PrDetail {
        let mut p = open(1);
        p.review = review;
        PrDetail { pr: p, head_ref: "h".into(), base_ref: "main".into(), check_list: vec![], reviews, requested: requested.into_iter().map(str::to_owned).collect() }
    }

    fn rs(decision: ReviewDecision, approvals: i64, required: Option<i64>) -> Option<ReviewSummary> {
        Some(ReviewSummary { decision, approvals, required })
    }

    #[test]
    fn review_lines() {
        assert_eq!(review_line(&detail(rs(ReviewDecision::Waiting, 1, Some(2)), vec![], vec![])).as_deref(), Some("1 of 2 approvals"));
        assert_eq!(review_line(&detail(rs(ReviewDecision::Approved, 2, Some(2)), vec![], vec![])).as_deref(), Some("Approved"));
        assert_eq!(review_line(&detail(rs(ReviewDecision::Changes, 0, None), vec![Review { author: "x".into(), state: ReviewState::Changes }], vec![])).as_deref(), Some("Changes requested by @x"));
        assert_eq!(review_line(&detail(rs(ReviewDecision::Waiting, 0, None), vec![], vec!["bo"])).as_deref(), Some("Waiting for review from @bo"));
        assert_eq!(review_line(&detail(rs(ReviewDecision::Waiting, 0, None), vec![], vec![])).as_deref(), Some("Waiting for review"));
        assert_eq!(review_line(&detail(None, vec![], vec![])), None);
        assert_eq!(review_line(&detail(rs(ReviewDecision::None, 0, None), vec![], vec![])), None);
    }

    #[test]
    fn tracked_prs_leave_links() {
        let tracked = "https://github.com/acme/widgets/pull/7";
        let untracked = "https://github.com/acme/widgets/pull/9";
        let highlights = ThreadHighlights::decode(&json!({"highlights": [
            {"id": "pr:7", "kind": "pr", "title": "acme/widgets#7", "url": tracked},
            {"id": "pr:9", "kind": "pr", "title": "acme/widgets#9", "url": untracked},
            {"id": "link:1", "kind": "link", "title": "Docs", "url": "https://example.com/docs"},
        ]}));
        let sections = crate::highlights::HighlightSections::build(&without_tracked(&highlights, &[open(7)]));
        assert_eq!(sections.links.iter().map(|h| h.url.clone().unwrap()).collect::<Vec<_>>(), vec![untracked.to_owned(), "https://example.com/docs".to_owned()]);
        assert_eq!(without_tracked(&highlights, &[]), highlights);
    }

    #[test]
    fn card_lines() {
        assert_eq!(subtitle(&with_state(683, PrState::Merged)), "widgets #683 · Merged");
        assert_eq!(subtitle(&with_state(5, PrState::Unknown)), "widgets #5");
        // Never fetched: the runner's "open" is a placeholder, so no state word.
        assert_eq!(subtitle(&pr(6, PrState::Open, None, None, false, false)), "widgets #6");
        assert_eq!(subtitle(&open(6)), "widgets #6 · Open");
        assert_eq!(checks_line(&with_checks(1, PrState::Open, ChecksState::Failing)).as_deref(), Some("Checks · 1 of 2 passed"));
        assert_eq!(checks_line(&open(1)), None);
        let now = chrono::Utc.timestamp_millis_opt(10_000_000).unwrap();
        let ago = |s: i64| Some(10_000_000 - s * 1000);
        assert_eq!(checked_line(ago(43), &now), "Checked 40s ago");
        assert_eq!(checked_line(ago(3), &now), "Checked just now");
        assert_eq!(checked_line(ago(300), &now), "Checked 5m ago");
        assert_eq!(checked_line(None, &now), "Not checked yet");
        assert!(fix_checks_prompt("https://github.com/acme/widgets/pull/7").starts_with("This pull request's checks are failing: https://github.com/acme/widgets/pull/7. Look with `gh pr checks https://github.com/acme/widgets/pull/7`"));
    }

    #[test]
    fn fix_failing_checks_only_for_open_or_draft() {
        assert!(can_fix_checks(&with_checks(1, PrState::Open, ChecksState::Failing)));
        assert!(can_fix_checks(&with_checks(1, PrState::Draft, ChecksState::Failing)));
        assert!(!can_fix_checks(&with_checks(1, PrState::Merged, ChecksState::Failing)));
        assert!(!can_fix_checks(&with_checks(1, PrState::Closed, ChecksState::Failing)));
        assert!(!can_fix_checks(&with_checks(1, PrState::Unknown, ChecksState::Failing)));
        assert!(!can_fix_checks(&with_checks(1, PrState::Open, ChecksState::Passing)));
        assert!(!can_fix_checks(&open(1)));
    }

    #[test]
    fn checks_sort_failed_first() {
        let checks = [Check::new("a", Outcome::Passed), Check::new("b", Outcome::Skipped), Check::new("c", Outcome::Running), Check::new("d", Outcome::Failed), Check::new("e", Outcome::Passed)];
        assert_eq!(sorted_checks(&checks).iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), vec!["d", "c", "a", "e", "b"]);
    }

    #[test]
    fn check_trailing_text() {
        // GitHub gives skipped runs start and end times; they still read as skipped.
        let mut skipped = Check::new("a", Outcome::Skipped);
        skipped.seconds = Some(0);
        assert_eq!(check_trailing(&skipped).as_deref(), Some("skipped"));
        assert_eq!(check_trailing(&Check::new("a", Outcome::Skipped)).as_deref(), Some("skipped"));
        let mut passed = Check::new("a", Outcome::Passed);
        passed.seconds = Some(64);
        assert_eq!(check_trailing(&passed).as_deref(), Some("1m 4s"));
        assert_eq!(check_trailing(&Check::new("a", Outcome::Running)), None);
    }

    #[test]
    fn only_web_links_open() {
        assert!(web_link(Some("https://github.com/acme/widgets/pull/7")).is_some());
        assert!(web_link(Some("http://ci.example.com/7")).is_some());
        assert!(web_link(Some("javascript:alert(1)")).is_none());
        assert!(web_link(Some("file:///etc/passwd")).is_none());
        assert!(web_link(None).is_none());
    }
}
