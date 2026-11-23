// The @ picker in the message box: typing "@" lists Tyler's open Chrome tabs
// from BrowserBear, and picking one lends it to the thread and puts a short
// reference to it in the message (docs/protocol.md, "The @ tab picker"). A
// port of the Swift app's TabMentions.swift and the rules in
// TabPaletteView.swift; the GPUI picker is desktop/gpui/src/tab_palette.rs.
use crate::slash::PaletteKey;
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;

/// One of Tyler's Chrome tabs, as BrowserBear's `tabList` gives it.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct BrowserTab {
    #[serde(deserialize_with = "crate::wire::field")]
    pub tab_id: i64,
    #[serde(deserialize_with = "crate::wire::field")]
    pub title: String,
    #[serde(deserialize_with = "crate::wire::field")]
    pub url: String,
    #[serde(deserialize_with = "crate::wire::field")]
    pub profile: Option<String>,
    #[serde(deserialize_with = "crate::wire::field")]
    pub active: Option<bool>,
    /// "user", "handed" (an agent's, handed over to him) or "agent".
    #[serde(deserialize_with = "crate::wire::field")]
    pub whose: Option<String>,
    /// The thread it's lent to, if any.
    #[serde(deserialize_with = "crate::wire::field")]
    pub lent_to: Option<String>,
    /// Whether the thread asked about may use this tab already: its site is
    /// on the allowed list, or the tab is lent to that thread. Picking it
    /// lends that one tab, never the whole site.
    #[serde(deserialize_with = "crate::wire::field")]
    pub allowed: Option<bool>,
    /// Chrome's favicon for the page, when BrowserBear sends it.
    #[serde(deserialize_with = "crate::wire::field")]
    pub fav_icon_url: Option<String>,
}

impl BrowserTab {
    /// "music.youtube.com", "localhost:5173"; the whole address for a file.
    pub fn host(&self) -> String {
        authority(&self.url)
            .filter(|a| !a.is_empty())
            .unwrap_or_else(|| self.url.clone())
    }

    /// Its title, or its host for a page without one.
    pub fn shown_title(&self) -> String {
        if self.title.trim().is_empty() {
            self.host()
        } else {
            self.title.clone()
        }
    }

    /// The picture for its row: Chrome's favicon when BrowserBear gives one
    /// (a web or data address, never chrome://), else the site's own
    /// /favicon.ico. None for a file.
    pub fn icon_url(&self) -> Option<String> {
        if let Some(icon) = self
            .fav_icon_url
            .as_deref()
            .filter(|i| matches!(scheme(i).as_deref(), Some("http" | "https" | "data")))
        {
            return Some(icon.to_owned());
        }
        let page_scheme = scheme(&self.url).filter(|s| s == "http" || s == "https")?;
        let host = authority(&self.url).filter(|a| !a.is_empty())?;
        Some(format!("{page_scheme}://{host}/favicon.ico"))
    }
}

/// An address's scheme, lower-cased.
fn scheme(url: &str) -> Option<String> {
    let (scheme, _) = url.split_once(':')?;
    (!scheme.is_empty()
        && scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.')))
    .then(|| scheme.to_ascii_lowercase())
}

/// `host[:port]` of `scheme://user@host:port/...`, without the user.
fn authority(url: &str) -> Option<String> {
    let (_, rest) = url.split_once("://")?;
    let authority = rest.split(['/', '?', '#']).next()?;
    Some(
        authority
            .rsplit_once('@')
            .map_or(authority, |(_, h)| h)
            .to_owned(),
    )
}

/// BrowserBear's `tabList` answer: a list, or one under `tabs` (leniently,
/// as a newer BrowserBear might wrap it). A tab that doesn't read is left out.
pub fn decode_tabs(value: &Value) -> Vec<BrowserTab> {
    let list = match value {
        Value::Array(list) => list.as_slice(),
        Value::Object(map) => map
            .get("tabs")
            .and_then(Value::as_array)
            .map_or(&[][..], Vec::as_slice),
        _ => &[],
    };
    list.iter()
        .filter_map(|t| serde_json::from_value::<BrowserTab>(t.clone()).ok())
        .filter(|t| t.tab_id != 0 || !t.url.is_empty())
        .collect()
}

/// Whether `status` says no Chrome profile is connected.
pub fn no_profile(status: &Value) -> bool {
    status
        .get("profiles")
        .and_then(Value::as_array)
        .is_none_or(|p| p.is_empty())
}

/// Why the picker has no tabs to show: said in its one row, never as an
/// error banner.
#[derive(Clone, Debug, PartialEq)]
pub enum Unavailable {
    NotRunning,
    NoProfile,
    Failed(String),
}

impl Unavailable {
    /// The picker's one row.
    pub fn text(&self) -> String {
        match self {
            Unavailable::NotRunning => {
                "BrowserBear isn't running, so there are no Chrome tabs to pick.".to_owned()
            }
            Unavailable::NoProfile => "No Chrome profile is connected to BrowserBear.".to_owned(),
            Unavailable::Failed(why) => format!("BrowserBear couldn't list your tabs: {why}"),
        }
    }

    /// The end of "Couldn't lend ... to this thread: <reason>."
    pub fn reason(&self) -> String {
        match self {
            Unavailable::NotRunning => "BrowserBear isn't running".to_owned(),
            Unavailable::NoProfile => "no Chrome profile is connected to BrowserBear".to_owned(),
            Unavailable::Failed(why) => why.clone(),
        }
    }
}

/// The "@word" being typed, as byte offsets into the box's text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Query {
    pub start: usize,
    pub end: usize,
    pub text: String,
}

fn is_space(c: char) -> bool {
    matches!(c, ' ' | '\t' | '\n' | '\r' | '\u{A0}')
}

/// The "@..." just before the cursor (a byte offset): an @ at the start or
/// after a space, then no space, picture or bracket up to the cursor. None
/// for an email address ("me@x.com") or once a space ends the word.
pub fn query(text: &str, cursor: usize) -> Option<Query> {
    if cursor == 0 || cursor > text.len() || !text.is_char_boundary(cursor) {
        return None;
    }
    let before = &text[..cursor];
    for (i, c) in before.char_indices().rev() {
        if c == '@' {
            if before[..i]
                .chars()
                .next_back()
                .is_some_and(|p| !is_space(p))
            {
                return None;
            }
            return Some(Query {
                start: i,
                end: cursor,
                text: before[i + 1..].to_owned(),
            });
        }
        if is_space(c) || c == crate::composer::PICTURE_MARK || c == '[' || c == ']' {
            return None;
        }
    }
    None
}

/// The tabs to offer: his own and those handed to him, never an agent's
/// own, in BrowserBear's order (his first, the front ones first), those
/// whose title or host has `query`, any case.
pub fn matches(tabs: &[BrowserTab], query: &str) -> Vec<BrowserTab> {
    let q = query.trim().to_lowercase();
    tabs.iter()
        .filter(|t| t.whose.as_deref() != Some("agent"))
        .filter(|t| {
            q.is_empty()
                || t.title.to_lowercase().contains(&q)
                || t.host().to_lowercase().contains(&q)
        })
        .cloned()
        .collect()
}

/// What goes in the message for a picked tab:
/// `@[YouTube Music](https://music.youtube.com/) (tab 283150292)`.
pub fn reference(tab: &BrowserTab) -> String {
    let mut title = tab
        .title
        .trim()
        .replace('[', "(")
        .replace(']', ")")
        .replace('\n', " ");
    if title.is_empty() {
        title = tab.host();
    }
    if title.chars().count() > 60 {
        title = title.chars().take(59).collect::<String>() + "…";
    }
    format!("@[{title}]({}) (tab {})", tab.url, tab.tab_id)
}

/// The message as sent: BrowserBear's words for each lent tab the text still
/// refers to, after it, in the order they're mentioned. The reference says
/// which tab; the words say how to use it.
pub fn message(text: &str, lent: &BTreeMap<i64, String>) -> String {
    let mut found: Vec<(usize, &str)> = lent
        .iter()
        .filter_map(|(id, words)| {
            text.find(&format!("(tab {id})"))
                .map(|at| (at, words.as_str()))
        })
        .collect();
    if found.is_empty() {
        return text.to_owned();
    }
    found.sort_by_key(|(at, _)| *at);
    std::iter::once(text)
        .chain(found.into_iter().map(|(_, w)| w))
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Whether the text still mentions this tab.
pub fn mentions(text: &str, tab_id: i64) -> bool {
    text.contains(&format!("(tab {tab_id})"))
}

/// Said for a tab whose lend hasn't answered by the time it's sent, or one
/// picked in the New Thread box, lent once the thread is made.
pub fn fallback_words(tab: &BrowserTab) -> String {
    let title: String = tab.title.chars().take(80).collect();
    format!(
        "I've lent you tab {id} in my Chrome through BrowserBear, \"{title}\" <{url}>. Start with `browserbear snap {id}`. It's my own tab: don't close it, and run `browserbear release {id}` when you've finished with it. You may use it on {host} even if that site isn't on the allowed list, but only in this tab and only in this thread.",
        id = tab.tab_id,
        url = tab.url,
        host = tab.host()
    )
}

/// The small note at a row's end.
pub fn hint(tab: &BrowserTab, thread: &str) -> Option<&'static str> {
    match tab.lent_to.as_deref() {
        Some(to) if to == thread => Some("Lent here"),
        Some(_) => Some("Lent to another thread"),
        None if tab.allowed == Some(false) => Some("Picking gives this chat this tab only"),
        None => None,
    }
}

/// A row's tooltip.
pub fn tip(tab: &BrowserTab, thread: &str) -> String {
    let mut tip = "Lend this tab to the thread and mention it in your message".to_owned();
    if tab.allowed == Some(false) {
        tip += &format!(". {} isn't on the allowed sites: picking it lets this chat use this one tab, not the site, until the tab is released or closed", tab.host());
    }
    if tab.lent_to.as_deref().is_some_and(|to| to != thread) {
        tip += ". It moves from the thread it's lent to now";
    }
    tip
}

/// The empty list's line.
pub fn empty_text(query: &str) -> String {
    if query.is_empty() {
        "No open tabs in Chrome.".to_owned()
    } else {
        format!("No tab matches @{query}.")
    }
}

/// What the composer keeps for its @ picker: the tab picked with the arrows,
/// and the text Esc closed it at (closed until the text changes).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PickerState {
    pub selected: Option<i64>,
    pub closed_at: Option<String>,
}

/// The tab Return would pick: the one the arrows are on, else the first.
pub fn picked<'a>(matches: &'a [BrowserTab], state: &PickerState) -> Option<&'a BrowserTab> {
    matches
        .iter()
        .find(|t| Some(t.tab_id) == state.selected)
        .or_else(|| matches.first())
}

/// What a key does with these matches: moves the pick, or gives the tab to
/// pick (Tab, Return). None: nothing picked.
pub fn handle_key(
    key: PaletteKey,
    matches: &[BrowserTab],
    state: &mut PickerState,
    text: &str,
) -> Option<BrowserTab> {
    let index = matches
        .iter()
        .position(|t| Some(t.tab_id) == state.selected)
        .unwrap_or(0);
    match key {
        PaletteKey::Up => {
            if !matches.is_empty() {
                state.selected = Some(matches[index.saturating_sub(1)].tab_id);
            }
        }
        PaletteKey::Down => {
            if !matches.is_empty() {
                state.selected = Some(matches[(index + 1).min(matches.len() - 1)].tab_id);
            }
        }
        PaletteKey::Escape => state.closed_at = Some(text.to_owned()),
        PaletteKey::Tab | PaletteKey::Enter => return matches.get(index).cloned(),
    }
    None
}

/// Room for the rows there are, between the panel's least and about half the
/// window, in points.
pub fn height(rows: usize, window: f64) -> f64 {
    let wanted = rows.max(2) as f64 * 44. + 12.;
    wanted.max(220.).min((window * 0.5).max(220.))
}

/// A favicon's bytes as one of the formats the app draws: PNG, JPEG, GIF,
/// WebP, SVG or BMP. An .ico (what most sites' /favicon.ico is) gives its
/// biggest picture, a PNG inside it as it is, a bitmap one as a BMP file.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IconFormat {
    Png,
    Jpeg,
    Gif,
    Webp,
    Svg,
    Bmp,
}

/// The biggest favicon read.
pub const MAX_ICON_BYTES: usize = 512 * 1024;

pub fn icon_picture(bytes: &[u8]) -> Option<(IconFormat, Vec<u8>)> {
    if bytes.is_empty() || bytes.len() > MAX_ICON_BYTES {
        return None;
    }
    if bytes.starts_with(b"\x89PNG") {
        return Some((IconFormat::Png, bytes.to_vec()));
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some((IconFormat::Jpeg, bytes.to_vec()));
    }
    if bytes.starts_with(b"GIF8") {
        return Some((IconFormat::Gif, bytes.to_vec()));
    }
    if bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some((IconFormat::Webp, bytes.to_vec()));
    }
    if bytes.starts_with(b"BM") {
        return Some((IconFormat::Bmp, bytes.to_vec()));
    }
    if bytes.starts_with(&[0, 0, 1, 0]) {
        return ico_picture(bytes);
    }
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(512)]).to_lowercase();
    (head.contains("<svg")).then(|| (IconFormat::Svg, bytes.to_vec()))
}

/// An .ico's biggest picture.
fn ico_picture(bytes: &[u8]) -> Option<(IconFormat, Vec<u8>)> {
    let u16_at = |at: usize| {
        bytes
            .get(at..at + 2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
    };
    let u32_at = |at: usize| {
        bytes
            .get(at..at + 4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    };
    let count = u16_at(4)? as usize;
    let mut best: Option<(u32, usize, usize)> = None;
    for i in 0..count.min(64) {
        let entry = 6 + i * 16;
        let w = match *bytes.get(entry)? {
            0 => 256,
            w => u32::from(w),
        };
        let size = u32_at(entry + 8)? as usize;
        let offset = u32_at(entry + 12)? as usize;
        if offset.checked_add(size).is_none_or(|end| end > bytes.len()) || size < 40 {
            continue;
        }
        if best.is_none_or(|(bw, _, _)| w > bw) {
            best = Some((w, offset, size));
        }
    }
    let (_, offset, size) = best?;
    let image = &bytes[offset..offset + size];
    if image.starts_with(b"\x89PNG") {
        return Some((IconFormat::Png, image.to_vec()));
    }
    // A bitmap: its header says twice the height (the picture, then its
    // mask). Half that, and a file header in front, makes it a .bmp.
    let header = u32::from_le_bytes(image[..4].try_into().ok()?);
    if header < 40 {
        return None;
    }
    let bits = u16::from_le_bytes(image[14..16].try_into().ok()?);
    let colours = u32::from_le_bytes(image[32..36].try_into().ok()?);
    let palette = if bits <= 8 {
        (if colours == 0 { 1u32 << bits } else { colours }) * 4
    } else {
        0
    };
    let mut dib = image.to_vec();
    let height = i32::from_le_bytes(dib[8..12].try_into().ok()?);
    dib[8..12].copy_from_slice(&(height / 2).to_le_bytes());
    let data_at = 14 + header + palette;
    let total = 14 + dib.len() as u32;
    let mut file = Vec::with_capacity(total as usize);
    file.extend_from_slice(b"BM");
    file.extend_from_slice(&total.to_le_bytes());
    file.extend_from_slice(&[0, 0, 0, 0]);
    file.extend_from_slice(&data_at.to_le_bytes());
    file.extend_from_slice(&dib);
    Some((IconFormat::Bmp, file))
}

/// A `data:` address's bytes (base64 or plain).
pub fn data_url_bytes(url: &str) -> Option<Vec<u8>> {
    use base64::Engine as _;
    let rest = url.get(5..).filter(|_| {
        url.get(..5)
            .is_some_and(|p| p.eq_ignore_ascii_case("data:"))
    })?;
    let (meta, data) = rest.split_once(',')?;
    if meta.to_ascii_lowercase().ends_with(";base64") {
        base64::engine::general_purpose::STANDARD
            .decode(data.trim())
            .ok()
    } else {
        Some(percent_decode(data))
    }
}

fn percent_decode(text: &str) -> Vec<u8> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Some(b) = std::str::from_utf8(&bytes[i + 1..i + 3])
                .ok()
                .and_then(|h| u8::from_str_radix(h, 16).ok())
            {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tab(id: i64, title: &str, url: &str) -> BrowserTab {
        BrowserTab {
            tab_id: id,
            title: title.into(),
            url: url.into(),
            profile: Some("me@example.com".into()),
            active: Some(false),
            whose: Some("user".into()),
            lent_to: None,
            allowed: Some(true),
            fav_icon_url: None,
        }
    }

    #[test]
    fn query_is_the_at_word_before_the_cursor() {
        assert_eq!(
            query("@", 1),
            Some(Query {
                start: 0,
                end: 1,
                text: String::new()
            })
        );
        assert_eq!(
            query("look at @you", 12).map(|q| q.text),
            Some("you".into())
        );
        assert_eq!(
            query("look at @you", 12).map(|q| (q.start, q.end)),
            Some((8, 12))
        );
        assert_eq!(
            query("@you and more", 4).map(|q| q.text),
            Some("you".into()),
            "only up to the cursor"
        );
        assert_eq!(query("mail me@example.com", 19), None, "an email address");
        assert_eq!(query("@you there", 10), None, "a space ends it");
        assert_eq!(query("@a\nb", 4), None);
        assert_eq!(query("hello", 5), None);
        assert_eq!(
            query("@[Music](https://m.example) (tab 3) ", 36),
            None,
            "a reference already made"
        );
        assert_eq!(query("line\n@x", 7).map(|q| q.text), Some("x".into()));
        let emoji = "🙂 @y";
        assert_eq!(
            query(emoji, emoji.len()).map(|q| (q.start, q.end)),
            Some((5, 7)),
            "byte offsets"
        );
        assert_eq!(
            query("a\u{FFFC}@x", "a\u{FFFC}@x".len()),
            None,
            "right after a picture"
        );
    }

    #[test]
    fn matches_leave_out_agent_tabs_and_filter_on_title_and_host() {
        let mut agent = tab(2, "Agent's page", "https://example.com/");
        agent.whose = Some("agent".into());
        let mut handed = tab(4, "Dev", "http://localhost:5173/");
        handed.whose = Some("handed".into());
        let tabs = vec![
            tab(1, "YouTube Music", "https://music.youtube.com/"),
            agent,
            tab(3, "Inbox", "https://mail.google.com/mail/u/0/"),
            handed,
        ];
        let ids = |q: &str| {
            matches(&tabs, q)
                .iter()
                .map(|t| t.tab_id)
                .collect::<Vec<_>>()
        };
        assert_eq!(ids(""), vec![1, 3, 4]);
        assert_eq!(ids("MUS"), vec![1]);
        assert_eq!(ids("google"), vec![3], "by its host");
        assert_eq!(ids("local"), vec![4]);
        assert!(ids("zzz").is_empty());
    }

    #[test]
    fn host_and_reference() {
        let t = tab(283150292, "YouTube Music", "https://music.youtube.com/");
        assert_eq!(t.host(), "music.youtube.com");
        assert_eq!(
            tab(1, "x", "http://localhost:5173/a").host(),
            "localhost:5173"
        );
        assert_eq!(
            reference(&t),
            "@[YouTube Music](https://music.youtube.com/) (tab 283150292)"
        );
        assert_eq!(
            reference(&tab(5, "a [b] c", "https://x.com/")),
            "@[a (b) c](https://x.com/) (tab 5)"
        );
        assert_eq!(
            reference(&tab(6, "  ", "https://x.com/")),
            "@[x.com](https://x.com/) (tab 6)"
        );
        let long = "a".repeat(100);
        assert_eq!(
            reference(&tab(7, &long, "https://x.com/")),
            format!("@[{}…](https://x.com/) (tab 7)", "a".repeat(59))
        );
    }

    #[test]
    fn message_adds_words_for_tabs_still_referenced() {
        let lent = BTreeMap::from([
            (5, "Tab 5 is yours.".to_owned()),
            (9, "Tab 9 is yours.".to_owned()),
        ]);
        assert_eq!(
            message("see @[A](https://a.com/) (tab 5) please", &lent),
            "see @[A](https://a.com/) (tab 5) please\n\nTab 5 is yours."
        );
        assert_eq!(message("no tabs", &lent), "no tabs");
        assert_eq!(
            message("(tab 9) and (tab 5)", &lent),
            "(tab 9) and (tab 5)\n\nTab 9 is yours.\n\nTab 5 is yours."
        );
        assert_eq!(message("(tab 55)", &lent), "(tab 55)", "not tab 5");
    }

    #[test]
    fn icon_is_chromes_or_the_sites_own() {
        let mut t = tab(1, "A", "http://localhost:5173/7k/orders?x=1");
        assert_eq!(
            t.icon_url().as_deref(),
            Some("http://localhost:5173/favicon.ico")
        );
        t.fav_icon_url = Some("https://music.youtube.com/img/favicon_32.png".into());
        assert_eq!(
            t.icon_url().as_deref(),
            Some("https://music.youtube.com/img/favicon_32.png"),
            "Chrome's when BrowserBear sends it"
        );
        t.fav_icon_url = Some("chrome://favicon/x".into());
        assert_eq!(
            t.icon_url().as_deref(),
            Some("http://localhost:5173/favicon.ico"),
            "not one of Chrome's own pages"
        );
        assert_eq!(tab(2, "f", "file:///Users/me/a.html").icon_url(), None);
    }

    #[test]
    fn decodes_the_services_list() {
        let tabs = decode_tabs(
            &json!([{"tabId":1,"title":"A","url":"https://a.com/","profile":"p","active":true,"whose":"user","lentTo":null,"allowed":false,"extra":1}, "junk"]),
        );
        assert_eq!(tabs.len(), 1);
        assert_eq!(tabs[0].allowed, Some(false));
        assert_eq!(tabs[0].lent_to, None);
        assert_eq!(
            decode_tabs(&json!({"tabs":[{"tabId":2,"url":"https://b.com/"}]}))[0].tab_id,
            2
        );
        assert!(no_profile(&json!({"profiles":[]})));
        assert!(no_profile(&json!({})));
        assert!(!no_profile(&json!({"profiles":[{"id":"p"}]})));
    }

    #[test]
    fn hints_and_tips() {
        let mut t = tab(1, "A", "https://a.com/");
        assert_eq!(hint(&t, "th"), None);
        t.allowed = Some(false);
        assert_eq!(
            hint(&t, "th"),
            Some("Picking gives this chat this tab only")
        );
        assert!(tip(&t, "th").contains("a.com isn't on the allowed sites"));
        t.lent_to = Some("th".into());
        assert_eq!(hint(&t, "th"), Some("Lent here"));
        t.lent_to = Some("other".into());
        assert_eq!(hint(&t, "th"), Some("Lent to another thread"));
        assert!(tip(&t, "th").ends_with("It moves from the thread it's lent to now"));
    }

    #[test]
    fn keys_move_and_pick() {
        let tabs = vec![
            tab(1, "A", "https://a.com/"),
            tab(2, "B", "https://b.com/"),
            tab(3, "C", "https://c.com/"),
        ];
        let mut state = PickerState::default();
        assert_eq!(picked(&tabs, &state).map(|t| t.tab_id), Some(1));
        assert_eq!(handle_key(PaletteKey::Down, &tabs, &mut state, "@"), None);
        assert_eq!(state.selected, Some(2));
        handle_key(PaletteKey::Down, &tabs, &mut state, "@");
        handle_key(PaletteKey::Down, &tabs, &mut state, "@");
        assert_eq!(state.selected, Some(3), "stays on the last");
        handle_key(PaletteKey::Up, &tabs, &mut state, "@");
        assert_eq!(
            handle_key(PaletteKey::Enter, &tabs, &mut state, "@").map(|t| t.tab_id),
            Some(2)
        );
        handle_key(PaletteKey::Escape, &tabs, &mut state, "@x");
        assert_eq!(state.closed_at.as_deref(), Some("@x"));
        assert_eq!(
            handle_key(PaletteKey::Tab, &[], &mut PickerState::default(), ""),
            None
        );
    }

    #[test]
    fn icon_pictures() {
        assert_eq!(
            icon_picture(b"\x89PNG\r\n").map(|p| p.0),
            Some(IconFormat::Png)
        );
        assert_eq!(
            icon_picture(b"<?xml version=\"1.0\"?><svg xmlns='x'/>").map(|p| p.0),
            Some(IconFormat::Svg)
        );
        assert_eq!(icon_picture(b"<html>nope</html>"), None);
        // An .ico holding one PNG.
        let png = b"\x89PNG\r\n\x1a\n0123456789012345678901234567890123456789".to_vec();
        let mut ico = vec![0, 0, 1, 0, 1, 0, 32, 32, 0, 0, 1, 0, 32, 0];
        ico.extend_from_slice(&(png.len() as u32).to_le_bytes());
        ico.extend_from_slice(&22u32.to_le_bytes());
        ico.extend_from_slice(&png);
        assert_eq!(icon_picture(&ico), Some((IconFormat::Png, png)));
        // An .ico holding a 1×1 32-bit bitmap: a BMP with half the height.
        let mut dib = vec![0u8; 40];
        dib[..4].copy_from_slice(&40u32.to_le_bytes());
        dib[4..8].copy_from_slice(&1i32.to_le_bytes());
        dib[8..12].copy_from_slice(&2i32.to_le_bytes());
        dib[12..14].copy_from_slice(&1u16.to_le_bytes());
        dib[14..16].copy_from_slice(&32u16.to_le_bytes());
        dib.extend_from_slice(&[1, 2, 3, 255, 0, 0, 0, 0]);
        let mut ico = vec![0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 32, 0];
        ico.extend_from_slice(&(dib.len() as u32).to_le_bytes());
        ico.extend_from_slice(&22u32.to_le_bytes());
        ico.extend_from_slice(&dib);
        let (format, bmp) = icon_picture(&ico).expect("a bitmap");
        assert_eq!(format, IconFormat::Bmp);
        assert_eq!(&bmp[..2], b"BM");
        assert_eq!(
            i32::from_le_bytes(bmp[22..26].try_into().unwrap()),
            1,
            "half the height"
        );
        assert_eq!(
            u32::from_le_bytes(bmp[10..14].try_into().unwrap()),
            54,
            "pixels after the headers"
        );
    }

    #[test]
    fn data_urls() {
        assert_eq!(
            data_url_bytes("data:image/svg+xml;base64,PHN2Zy8+").as_deref(),
            Some(&b"<svg/>"[..])
        );
        assert_eq!(
            data_url_bytes("data:image/svg+xml,%3Csvg/%3E").as_deref(),
            Some(&b"<svg/>"[..])
        );
        assert_eq!(data_url_bytes("https://x"), None);
    }
}
