// The # picker in the message box: typing "#" lists Tyler's threads, those
// whose title, folder or id has what's typed after it, and picking one puts
// the thread's id where the #word was, so the agent can read_thread or
// send_message it. Drawn as the @ tab picker is (tab_mentions.rs); the GPUI
// picker is desktop/gpui/src/thread_palette.rs.
use crate::inbox::ThreadSummary;
use crate::slash::PaletteKey;
use std::sync::Arc;

/// The most rows the picker lists.
pub const MAX_ROWS: usize = 50;

/// The "#..." just before the cursor: where it starts and ends (byte
/// offsets) and what's typed after the #.
#[derive(Clone, Debug, PartialEq)]
pub struct Query {
    pub start: usize,
    pub end: usize,
    pub text: String,
}

fn is_space(c: char) -> bool {
    matches!(c, ' ' | '\t' | '\n' | '\r' | '\u{A0}')
}

/// The "#..." just before the cursor (a byte offset): a # at the start or
/// after a space, then no space, picture or bracket up to the cursor. None
/// for "a#b", or once a space ends the word (so "# Heading" closes it).
pub fn query(text: &str, cursor: usize) -> Option<Query> {
    if cursor == 0 || cursor > text.len() || !text.is_char_boundary(cursor) {
        return None;
    }
    let before = &text[..cursor];
    for (i, c) in before.char_indices().rev() {
        if c == '#' {
            if before[..i].chars().next_back().is_some_and(|p| !is_space(p)) {
                return None;
            }
            return Some(Query { start: i, end: cursor, text: before[i + 1..].to_owned() });
        }
        if is_space(c) || c == crate::composer::PICTURE_MARK || c == '[' || c == ']' || c == '#' {
            return None;
        }
    }
    None
}

/// The title a row shows.
pub fn shown_title(thread: &ThreadSummary) -> String {
    let title = thread.title.trim();
    if title.is_empty() { "Untitled thread".to_owned() } else { title.replace('\n', " ") }
}

/// The last part of the thread's folder.
pub fn folder(thread: &ThreadSummary) -> String {
    thread.cwd.trim_end_matches('/').rsplit('/').next().unwrap_or_default().to_owned()
}

/// The threads to offer, most recently active first, at most `MAX_ROWS`:
/// not `current` (the box's own thread), and not archived ones unless
/// something's typed. A thread matches when every word typed is in its
/// title or folder, any case, or what's typed starts its id.
pub fn matches(threads: &[Arc<ThreadSummary>], query: &str, current: Option<&str>) -> Vec<Arc<ThreadSummary>> {
    let q = query.trim().to_lowercase();
    let words: Vec<&str> = q.split_whitespace().collect();
    let mut found: Vec<Arc<ThreadSummary>> = threads
        .iter()
        .filter(|t| Some(t.id.as_str()) != current)
        .filter(|t| !q.is_empty() || t.archived_at.is_none())
        .filter(|t| {
            if q.is_empty() || t.id.to_lowercase().starts_with(&q) {
                return true;
            }
            let hay = format!("{} {}", t.title.to_lowercase(), folder(t).to_lowercase());
            words.iter().all(|w| hay.contains(w))
        })
        .cloned()
        .collect();
    // Archived ones after the rest, then the latest first.
    found.sort_by(|a, b| a.archived_at.is_some().cmp(&b.archived_at.is_some()).then_with(|| b.last_activity_at.cmp(&a.last_activity_at)));
    found.truncate(MAX_ROWS);
    found
}

/// What goes in the message for a picked thread: its id.
pub fn reference(thread: &ThreadSummary) -> String {
    thread.id.clone()
}

/// The picker's line when nothing matches.
pub fn empty_text(query: &str) -> String {
    if query.is_empty() { "No other threads.".to_owned() } else { format!("No thread matches #{query}.") }
}

/// What the composer keeps for its # picker: the thread the arrows are on,
/// and the text Esc closed it at (closed until the text changes).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PickerState {
    pub selected: Option<String>,
    pub closed_at: Option<String>,
}

/// The thread Return would pick: the one the arrows are on, else the first.
pub fn picked<'a>(matches: &'a [Arc<ThreadSummary>], state: &PickerState) -> Option<&'a Arc<ThreadSummary>> {
    matches.iter().find(|t| state.selected.as_deref() == Some(t.id.as_str())).or_else(|| matches.first())
}

/// What a key does with these matches: moves the pick, or gives the thread
/// to pick (Tab, Return). None: nothing picked.
pub fn handle_key(key: PaletteKey, matches: &[Arc<ThreadSummary>], state: &mut PickerState, text: &str) -> Option<Arc<ThreadSummary>> {
    let index = matches.iter().position(|t| state.selected.as_deref() == Some(t.id.as_str())).unwrap_or(0);
    match key {
        PaletteKey::Up => {
            if !matches.is_empty() {
                state.selected = Some(matches[index.saturating_sub(1)].id.clone());
            }
        }
        PaletteKey::Down => {
            if !matches.is_empty() {
                state.selected = Some(matches[(index + 1).min(matches.len() - 1)].id.clone());
            }
        }
        PaletteKey::Escape => state.closed_at = Some(text.to_owned()),
        PaletteKey::Tab | PaletteKey::Enter => return matches.get(index).cloned(),
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn thread(id: &str, title: &str, cwd: &str, at: &str) -> Arc<ThreadSummary> {
        Arc::new(ThreadSummary { id: id.into(), title: title.into(), cwd: cwd.into(), last_activity_at: at.into(), ..Default::default() })
    }

    #[test]
    fn query_opens_after_a_hash_at_a_word_start() {
        assert_eq!(query("#", 1), Some(Query { start: 0, end: 1, text: String::new() }));
        assert_eq!(query("see #ware", 9), Some(Query { start: 4, end: 9, text: "ware".into() }));
        assert_eq!(query("a#b", 3), None);
        assert_eq!(query("# Heading", 9), None);
        assert_eq!(query("#one two", 8), None);
        assert_eq!(query("##", 2), None);
    }

    #[test]
    fn matches_by_title_folder_or_id_latest_first() {
        let all = vec![
            thread("aaa-1", "Fix deploy", "/r/warehouse", "2026-11-01"),
            thread("bbb-2", "Storage plan", "/r/warehouse", "2026-11-03"),
            thread("ccc-3", "Picker", "/Users/t/ThreadbearThreads", "2026-11-02"),
        ];
        let ids = |m: Vec<Arc<ThreadSummary>>| m.iter().map(|t| t.id.clone()).collect::<Vec<_>>();
        assert_eq!(ids(matches(&all, "", None)), ["bbb-2", "ccc-3", "aaa-1"]);
        assert_eq!(ids(matches(&all, "", Some("bbb-2"))), ["ccc-3", "aaa-1"]);
        assert_eq!(ids(matches(&all, "WARE", None)), ["bbb-2", "aaa-1"]);
        assert_eq!(ids(matches(&all, "deploy ware", None)), ["aaa-1"]);
        assert_eq!(ids(matches(&all, "ccc", None)), ["ccc-3"]);
    }

    #[test]
    fn archived_only_when_searched_and_last() {
        let mut old = (*thread("old", "Picker old", "/x", "2026-11-09")).clone();
        old.archived_at = Some("2026-11-10".into());
        let all = vec![Arc::new(old), thread("new", "Picker new", "/x", "2026-11-01")];
        assert_eq!(matches(&all, "", None).len(), 1);
        let found = matches(&all, "picker", None);
        assert_eq!(found.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["new", "old"]);
    }

    #[test]
    fn keys_move_and_pick() {
        let all = vec![thread("a", "A", "/x", "3"), thread("b", "B", "/x", "2")];
        let mut state = PickerState::default();
        assert_eq!(handle_key(PaletteKey::Down, &all, &mut state, ""), None);
        assert_eq!(state.selected.as_deref(), Some("b"));
        assert_eq!(handle_key(PaletteKey::Enter, &all, &mut state, "").map(|t| t.id.clone()).as_deref(), Some("b"));
        handle_key(PaletteKey::Escape, &all, &mut state, "#x");
        assert_eq!(state.closed_at.as_deref(), Some("#x"));
    }
}
