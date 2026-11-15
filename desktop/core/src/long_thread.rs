//! The long thread card by the composer (docs/protocol.md, "Long threads";
//! Swift `LongThread`). The runner says when a thread's context is past
//! runner.json's contextNudge levels (`contextLong`), and this decides what
//! the card shows. Every model call re-reads the whole conversation, so a
//! long one costs more each turn and the model keeps track of early details
//! less well.
use crate::composer::ContextMeter;
use crate::inbox::ThreadSummary;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// The thread a long one carried on in (`ContinuedIn`).
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct ContinuedIn {
    #[serde(default, deserialize_with = "crate::wire::field")]
    pub thread_id: String,
    #[serde(default, deserialize_with = "crate::wire::field")]
    pub title: String,
}

/// What the card shows.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LongThread {
    /// Past a level: Compact, Continue in a new thread or Not now.
    Suggest { firm: bool, tokens: i64 },
    /// Continue in a new thread's handoff is being written.
    Writing,
    /// It carried on in another thread.
    Continued(ContinuedIn),
}

/// Not now: the card stays hidden for the thread up to this rank, while its
/// context hasn't dropped below what it was (a compact voids it). Saved per
/// thread as the Swift app's `longThreadDismissals` has it.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(default)]
pub struct Dismissal {
    pub rank: i64,
    pub tokens: i64,
}

/// At most this many threads' Not now are kept; the oldest go first.
pub const KEPT_DISMISSALS: usize = 500;

impl LongThread {
    /// How far along: what Not now hides, up to and including.
    fn rank(&self) -> i64 {
        match self {
            LongThread::Suggest { firm, .. } => if *firm { 2 } else { 1 },
            LongThread::Writing => 0,
            LongThread::Continued(_) => 3,
        }
    }

    /// The card for `thread`, if any. Only between turns, apart from the
    /// handoff the click started.
    pub fn card(thread: &ThreadSummary, dismissed: Option<&Dismissal>) -> Option<LongThread> {
        if thread.sample == Some(true) {
            return None;
        }
        if thread.continuing {
            return Some(LongThread::Writing);
        }
        if thread.busy() {
            return None;
        }
        let card = if let Some(next) = thread.continued_in.clone().filter(|n| !n.thread_id.is_empty()) {
            LongThread::Continued(next)
        } else {
            match (thread.context_long.as_deref(), thread.context_tokens) {
                (Some(level @ ("gentle" | "firm")), Some(tokens)) => LongThread::Suggest { firm: level == "firm", tokens },
                _ => return None,
            }
        };
        if let Some(d) = dismissed {
            if d.rank >= card.rank() && thread.context_tokens.unwrap_or(0) >= d.tokens {
                return None;
            }
        }
        Some(card)
    }

    /// What Not now on this card records.
    pub fn dismissal(&self, tokens: Option<i64>) -> Dismissal {
        Dismissal { rank: self.rank(), tokens: tokens.unwrap_or(0) }
    }

    /// The card's words.
    pub fn message(&self) -> String {
        match self {
            LongThread::Suggest { firm: false, tokens } => format!(
                "This conversation is long ({} tokens). Every reply re-reads all of it, so each one costs more and early details get harder to keep track of.",
                ContextMeter::tokens(*tokens)
            ),
            LongThread::Suggest { firm: true, tokens } => format!(
                "This conversation is very long ({} tokens). Compact it or carry on in a new thread to make replies cheaper and sharper.",
                ContextMeter::tokens(*tokens)
            ),
            LongThread::Writing => "Writing a handoff for the new thread…".into(),
            LongThread::Continued(next) => format!("Carried on in \u{201C}{}\u{201D}.", next.title),
        }
    }
}

/// Records Not now for `thread`, keeping at most `KEPT_DISMISSALS` (by key
/// order, as the Swift dictionary drops an arbitrary one: which old thread's
/// goes doesn't matter).
pub fn remember(all: &mut BTreeMap<String, Dismissal>, thread: &str, dismissal: Dismissal) {
    all.insert(thread.to_owned(), dismissal);
    while all.len() > KEPT_DISMISSALS {
        let Some(first) = all.keys().find(|k| k.as_str() != thread).cloned() else { break };
        all.remove(&first);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn thread(long: Option<&str>, tokens: Option<i64>, status: &str) -> ThreadSummary {
        ThreadSummary { id: "t1".into(), title: "T".into(), status: status.into(), context_tokens: tokens, context_long: long.map(Into::into), ..Default::default() }
    }

    #[test]
    fn shows_the_runners_level_between_turns_only() {
        assert_eq!(LongThread::card(&thread(None, Some(100_000), "idle"), None), None);
        assert_eq!(LongThread::card(&thread(Some("gentle"), Some(160_000), "idle"), None), Some(LongThread::Suggest { firm: false, tokens: 160_000 }));
        assert_eq!(LongThread::card(&thread(Some("firm"), Some(260_000), "idle"), None), Some(LongThread::Suggest { firm: true, tokens: 260_000 }));
        assert_eq!(LongThread::card(&thread(Some("firm"), Some(260_000), "running"), None), None);
        // A level from a newer runner it doesn't know.
        assert_eq!(LongThread::card(&thread(Some("huge"), Some(900_000), "idle"), None), None);
        let mut sample = thread(Some("firm"), Some(260_000), "idle");
        sample.sample = Some(true);
        assert_eq!(LongThread::card(&sample, None), None);
    }

    #[test]
    fn not_now_holds_until_the_next_level() {
        let gentle = LongThread::card(&thread(Some("gentle"), Some(160_000), "idle"), None).unwrap();
        let dismissed = gentle.dismissal(Some(160_000));
        assert_eq!(LongThread::card(&thread(Some("gentle"), Some(200_000), "idle"), Some(&dismissed)), None);
        assert_eq!(LongThread::card(&thread(Some("firm"), Some(255_000), "idle"), Some(&dismissed)), Some(LongThread::Suggest { firm: true, tokens: 255_000 }));
        let firm = LongThread::Suggest { firm: true, tokens: 255_000 }.dismissal(Some(255_000));
        assert_eq!(LongThread::card(&thread(Some("firm"), Some(400_000), "idle"), Some(&firm)), None);
    }

    #[test]
    fn a_compact_voids_not_now() {
        let dismissed = Dismissal { rank: 2, tokens: 300_000 };
        // Compacted to 20k, then grown past the gentle level again.
        assert_eq!(LongThread::card(&thread(Some("gentle"), Some(170_000), "idle"), Some(&dismissed)), Some(LongThread::Suggest { firm: false, tokens: 170_000 }));
    }

    #[test]
    fn the_handoff_and_where_it_went() {
        let mut t = thread(Some("firm"), Some(300_000), "running");
        t.continuing = true;
        assert_eq!(LongThread::card(&t, None), Some(LongThread::Writing));
        t.continuing = false;
        t.status = "idle".into();
        t.continued_in = Some(ContinuedIn { thread_id: "t2".into(), title: "T (continued)".into() });
        let card = LongThread::card(&t, None).unwrap();
        assert_eq!(card, LongThread::Continued(ContinuedIn { thread_id: "t2".into(), title: "T (continued)".into() }));
        assert_eq!(card.message(), "Carried on in \u{201C}T (continued)\u{201D}.");
        assert_eq!(LongThread::card(&t, Some(&card.dismissal(Some(300_000)))), None);
    }

    #[test]
    fn the_words() {
        assert!(LongThread::Suggest { firm: false, tokens: 162_000 }.message().starts_with("This conversation is long (162k tokens)."));
        assert!(LongThread::Suggest { firm: true, tokens: 262_000 }.message().starts_with("This conversation is very long (262k tokens)."));
    }

    #[test]
    fn decodes_the_summary_fields() {
        let json = r#"{"id":"t1","title":"T","status":"idle","contextTokens":160000,"contextLong":"gentle","continuing":true,"continuedIn":{"threadId":"t2","title":"Next"}}"#;
        let t: ThreadSummary = serde_json::from_str(json).unwrap();
        assert_eq!(t.context_long.as_deref(), Some("gentle"));
        assert!(t.continuing);
        assert_eq!(t.continued_in, Some(ContinuedIn { thread_id: "t2".into(), title: "Next".into() }));
        // Junk in one field leaves the rest standing.
        let t: ThreadSummary = serde_json::from_str(r#"{"id":"t1","continuing":"yes","continuedIn":7}"#).unwrap();
        assert!(!t.continuing);
        assert_eq!(t.continued_in, None);
    }

    #[test]
    fn keeps_at_most_five_hundred() {
        let mut all = BTreeMap::new();
        for i in 0..=KEPT_DISMISSALS {
            remember(&mut all, &format!("t{i:04}"), Dismissal { rank: 1, tokens: 1 });
        }
        assert_eq!(all.len(), KEPT_DISMISSALS);
        assert!(all.contains_key(&format!("t{KEPT_DISMISSALS:04}")));
    }
}
