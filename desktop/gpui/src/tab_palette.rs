// The @ picker over the message box: Tyler's open Chrome tabs from
// BrowserBear, those whose title or host has what's typed after the @
// (TabPaletteView.swift, docs/protocol.md "The @ tab picker"). Arrows move,
// Return or Tab or a click picks one, Esc closes it. Picking one puts a short
// reference to the tab in the message and lends the tab to the thread at once,
// so the claim is there by the agent's first command; on send, BrowserBear's
// words on how to use it go after the message. In the New Thread box there's
// no thread to lend it to yet, so it's lent the moment the thread is made.
//
// Only for a thread on this Mac's runner (or a new one starting here):
// BrowserBear and Chrome are here, and another Mac's agent couldn't reach the
// tab. The rules are threadbear_core::tab_mentions; BrowserBear's socket is
// agent_browser.rs's, so a scripted app without BROWSERBEAR_HOME never
// reaches the real one. Drawn as the slash palette is (slash_palette.rs), in
// a deferred layer on the box's top edge, and the slash palette goes first.
use crate::app::Threadbear;
use crate::composer::Composer;
use crate::style::{self, size};
use crate::tips::Tip as _;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::{h_flex, v_flex, ActiveTheme as _};
use gpui_kit::prelude::*;
use gpui_kit::*;
// Shadows gpui's px, so sizes here follow the app's zoom (style.rs).
use crate::style::px;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use threadbear_core::slash::PaletteKey;
use threadbear_core::tab_mentions::{self as tabs, BrowserTab, IconFormat, Unavailable};

/// Where the New Thread box's tabs are kept, as a thread's are under its id.
pub(crate) const NEW_THREAD_KEY: &str = "new";

/// How long a favicon is waited for.
const ICON_WITHIN: Duration = Duration::from_secs(5);

/// A row's favicon, as far as it's got.
#[derive(Clone)]
enum Favicon {
    Loading,
    Ready(Arc<Image>),
    None,
}

/// What the app keeps for the @ pickers (`AppModel.browserTabs`, `lentTabs`,
/// `tabsToLend`); the app holds one.
#[derive(Default)]
pub(crate) struct TabPickerState {
    /// The tabs each box's picker last got, by thread id (or "new").
    tabs: HashMap<String, Result<Vec<BrowserTab>, Unavailable>>,
    fetching: HashSet<String>,
    /// Tabs picked and lent, with the words for each, by thread id (or "new").
    lent: HashMap<String, BTreeMap<i64, String>>,
    /// Tabs picked in the New Thread box, lent once it's made.
    to_lend: BTreeMap<i64, BrowserTab>,
    /// Those the New Thread box's message mentioned when it was sent, lent
    /// as soon as the runner says it made the thread.
    lend_on_create: Vec<BrowserTab>,
    favicons: HashMap<String, Favicon>,
}

impl Threadbear {
    /// `loadBrowserTabs`: asks BrowserBear for the tabs each time a picker
    /// opens, so a tab opened meanwhile is there. `thread` is None for the
    /// New Thread box, which asks with no thread (`allowed` is then every
    /// thread's list).
    pub(crate) fn load_browser_tabs(
        &mut self,
        key: String,
        thread: Option<String>,
        cx: &mut Context<Self>,
    ) {
        if !self.tab_picker.fetching.insert(key.clone()) {
            return;
        }
        let me = cx.entity().downgrade();
        let args = thread.map_or_else(|| json!({}), |t| json!({ "for": t }));
        let key_for_answer = key.clone();
        let asked = crate::agent_browser::model(cx).is_some_and(|bear| {
            bear.update(cx, |bear, cx| {
                bear.ask("tabList", args, cx, move |got, cx| {
                    let key = key_for_answer;
                    match got {
                        Ok(value) => {
                            let list = tabs::decode_tabs(&value);
                            if !list.is_empty() {
                                return Self::took_tabs(&me, key, Ok(list), cx);
                            }
                            // None at all: say so if no Chrome profile is connected.
                            let me_status = me.clone();
                            let key_status = key.clone();
                            let asked = crate::agent_browser::model(cx).is_some_and(|bear| {
                                bear.update(cx, |bear, cx| {
                                    bear.ask("status", json!({}), cx, move |status, cx| {
                                        let result = match status {
                                            Ok(s) if tabs::no_profile(&s) => {
                                                Err(Unavailable::NoProfile)
                                            }
                                            _ => Ok(vec![]),
                                        };
                                        Self::took_tabs(&me_status, key_status, result, cx);
                                    })
                                })
                            });
                            if !asked {
                                Self::took_tabs(&me, key, Ok(vec![]), cx);
                            }
                        }
                        Err(why) => Self::took_tabs(&me, key, Err(Unavailable::Failed(why)), cx),
                    }
                })
            })
        });
        if !asked {
            self.tab_picker.fetching.remove(&key);
            self.tab_picker
                .tabs
                .insert(key, Err(Unavailable::NotRunning));
            self.notify_composers(cx);
        }
    }

    fn took_tabs(
        me: &WeakEntity<Threadbear>,
        key: String,
        result: Result<Vec<BrowserTab>, Unavailable>,
        cx: &mut App,
    ) {
        me.update(cx, |this, cx| {
            this.tab_picker.fetching.remove(&key);
            this.tab_picker.tabs.insert(key, result);
            this.notify_composers(cx);
        })
        .ok();
    }

    /// The box draws from the app's state: tell it something came in.
    fn notify_composers(&self, cx: &mut Context<Self>) {
        if let Some(composer) = self.composer(cx) {
            composer.update(cx, |_, cx| cx.notify());
        }
        cx.notify();
    }

    /// `lendTab`: lends a picked tab to the thread at once, so the claim is in
    /// place by the agent's first command. Until BrowserBear answers, the
    /// message would carry words made here; a lend that fails says so, and
    /// the row it showed as lent goes back as it was.
    pub(crate) fn lend_tab(
        &mut self,
        tab: BrowserTab,
        thread: String,
        before: Option<(Option<String>, Option<bool>)>,
        cx: &mut Context<Self>,
    ) {
        self.tab_picker
            .lent
            .entry(thread.clone())
            .or_default()
            .insert(tab.tab_id, tabs::fallback_words(&tab));
        let me = cx.entity().downgrade();
        let failed = {
            let me = me.clone();
            let (tab, thread) = (tab.clone(), thread.clone());
            move |why: Unavailable, cx: &mut App| {
                me.update(cx, |this, cx| {
                    if let Some(lent) = this.tab_picker.lent.get_mut(&thread) {
                        lent.remove(&tab.tab_id);
                    }
                    // The row it showed as lent here goes back as it was.
                    if let (Some(Ok(list)), Some((lent_to, allowed))) =
                        (this.tab_picker.tabs.get_mut(&thread), before.clone())
                    {
                        if let Some(row) = list.iter_mut().find(|t| t.tab_id == tab.tab_id) {
                            row.lent_to = lent_to;
                            row.allowed = allowed;
                        }
                    }
                    this.show_error(
                        format!(
                            "Couldn't lend \"{}\" to this thread: {}.",
                            tab.shown_title(),
                            why.reason()
                        ),
                        cx,
                    );
                    this.notify_composers(cx);
                })
                .ok();
            }
        };
        let args = json!({ "tab": tab.tab_id, "to": thread });
        let (tab_id, lent_thread) = (tab.tab_id, thread);
        let failed_for_answer = failed.clone();
        let asked = crate::agent_browser::model(cx).is_some_and(|bear| {
            bear.update(cx, |bear, cx| {
                bear.ask("lendTo", args, cx, move |got, cx| match got {
                    Ok(value) => match value["words"].as_str() {
                        Some(words) => {
                            let words = words.to_owned();
                            me.update(cx, |this, _| {
                                this.tab_picker
                                    .lent
                                    .entry(lent_thread)
                                    .or_default()
                                    .insert(tab_id, words);
                            })
                            .ok();
                        }
                        None => failed_for_answer(
                            Unavailable::Failed("BrowserBear didn't say how to use the tab".into()),
                            cx,
                        ),
                    },
                    Err(why) => failed_for_answer(Unavailable::Failed(why), cx),
                })
            })
        });
        if !asked {
            cx.defer(move |cx| failed(Unavailable::NotRunning, cx));
        }
    }

    /// `lendWhenMade`: a tab picked in the New Thread box. There's no thread
    /// to lend it to yet, so the message carries words made here, and it's
    /// lent the moment the thread exists.
    pub(crate) fn lend_when_made(&mut self, tab: BrowserTab) {
        self.tab_picker
            .lent
            .entry(NEW_THREAD_KEY.to_owned())
            .or_default()
            .insert(tab.tab_id, tabs::fallback_words(&tab));
        self.tab_picker.to_lend.insert(tab.tab_id, tab);
    }

    /// The message as it goes from `key`'s box: BrowserBear's words for each
    /// tab it still mentions. For the New Thread box (starting on this Mac),
    /// the tabs it mentions are lent once the thread is made.
    pub(crate) fn with_tab_words(&mut self, key: &str, text: String) -> String {
        if key == NEW_THREAD_KEY {
            self.tab_picker.lend_on_create = self
                .tab_picker
                .to_lend
                .values()
                .filter(|t| tabs::mentions(&text, t.tab_id))
                .cloned()
                .collect();
        }
        match self.tab_picker.lent.get(key) {
            Some(lent) => tabs::message(&text, lent),
            None => text,
        }
    }

    /// The New Thread box's thread was made: its first turn has started, so
    /// the picked tabs are lent now, before the agent's first reply can use
    /// them.
    pub(crate) fn lend_new_thread_tabs(&mut self, thread: &str, cx: &mut Context<Self>) {
        for tab in std::mem::take(&mut self.tab_picker.lend_on_create) {
            self.lend_tab(tab, thread.to_owned(), None, cx);
        }
        self.tab_picker.to_lend.clear();
        self.tab_picker.lent.remove(NEW_THREAD_KEY);
        self.tab_picker.tabs.remove(NEW_THREAD_KEY);
    }

    /// Fetches a row's favicon once, off the main thread (a `data:` address
    /// is read here, a web one fetched plainly, without Chrome's sign-ins).
    fn load_favicon(&mut self, url: String, cx: &mut Context<Self>) {
        if self.tab_picker.favicons.contains_key(&url) {
            return;
        }
        self.tab_picker
            .favicons
            .insert(url.clone(), Favicon::Loading);
        let task = cx.background_spawn({
            let url = url.clone();
            async move { fetch_icon(&url) }
        });
        cx.spawn(async move |this, cx| {
            let got = task.await;
            this.update(cx, |this, cx| {
                let icon = got.map_or(Favicon::None, |(format, bytes)| {
                    Favicon::Ready(Arc::new(Image::from_bytes(gpui_format(format), bytes)))
                });
                this.tab_picker.favicons.insert(url, icon);
                this.notify_composers(cx);
            })
            .ok();
        })
        .detach();
    }
}

fn gpui_format(format: IconFormat) -> ImageFormat {
    match format {
        IconFormat::Png => ImageFormat::Png,
        IconFormat::Jpeg => ImageFormat::Jpeg,
        IconFormat::Gif => ImageFormat::Gif,
        IconFormat::Webp => ImageFormat::Webp,
        IconFormat::Svg => ImageFormat::Svg,
        IconFormat::Bmp => ImageFormat::Bmp,
    }
}

/// A favicon's picture: a `data:` address's bytes, or a plain GET of a web
/// one, at most `MAX_ICON_BYTES`, within a few seconds.
fn fetch_icon(url: &str) -> Option<(IconFormat, Vec<u8>)> {
    if url
        .get(..5)
        .is_some_and(|p| p.eq_ignore_ascii_case("data:"))
    {
        return tabs::icon_picture(&tabs::data_url_bytes(url)?);
    }
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(ICON_WITHIN))
        .user_agent("threadbear-desktop")
        .build()
        .into();
    let mut response = agent.get(url).call().ok()?;
    let bytes = response
        .body_mut()
        .with_config()
        .limit(tabs::MAX_ICON_BYTES as u64)
        .read_to_vec()
        .ok()?;
    tabs::icon_picture(&bytes)
}

/// What the picker shows for what's typed: read each time it's drawn.
struct PickerView {
    key: String,
    /// The thread it lends to, or None for the New Thread box.
    thread: Option<String>,
    query: tabs::Query,
    /// None while BrowserBear is being asked.
    tabs: Option<Result<Vec<BrowserTab>, Unavailable>>,
}

impl PickerView {
    fn matches(&self) -> Vec<BrowserTab> {
        match &self.tabs {
            Some(Ok(all)) => tabs::matches(all, &self.query.text),
            _ => vec![],
        }
    }

    /// The picker's one line when there are no rows to pick.
    fn note(&self) -> Option<String> {
        match &self.tabs {
            None => Some("Getting your Chrome tabs…".to_owned()),
            Some(Err(why)) => Some(why.text()),
            Some(Ok(_)) if self.matches().is_empty() => Some(tabs::empty_text(&self.query.text)),
            Some(Ok(_)) => None,
        }
    }
}

impl Composer {
    /// Where this box's tabs are kept: its thread's id, or "new".
    fn tab_key(&self) -> String {
        self.thread_id
            .clone()
            .unwrap_or_else(|| NEW_THREAD_KEY.to_owned())
    }

    /// `tabQuery`: the "@word" before the cursor while the picker is open.
    /// Only for a thread on this Mac's runner (or a new one starting here),
    /// not while the slash palette is open, not with a selection, and not
    /// once Esc closed it at this text.
    fn tab_query(&self, cx: &App) -> Option<tabs::Query> {
        let state = self.input.read(cx);
        let text = state.value().to_string();
        if self.tab_picker.closed_at.as_deref() == Some(text.as_str())
            || self.palette_typed(&text).is_some()
        {
            return None;
        }
        if !state.selected_range().is_empty() {
            return None;
        }
        let cursor = state.cursor();
        let query = tabs::query(&text, cursor)?;
        // On another Mac's thread, or a new one starting there: no picker.
        if self.chip_data(cx).away.is_some() {
            return None;
        }
        Some(query)
    }

    fn tab_view(&self, cx: &App) -> Option<PickerView> {
        let query = self.tab_query(cx)?;
        let key = self.tab_key();
        let tabs = self
            .app
            .upgrade()
            .and_then(|app| app.read(cx).tab_picker.tabs.get(&key).cloned());
        Some(PickerView {
            key,
            thread: self.thread_id.clone(),
            query,
            tabs,
        })
    }

    /// The message as it goes: BrowserBear's words added for each tab picked
    /// with @ that it still mentions. Only on this Mac's runner, where the
    /// tabs are lent; a new thread starting elsewhere goes as typed.
    pub(crate) fn with_tab_words(&self, text: String, cx: &mut Context<Self>) -> String {
        if self.chip_data(cx).away.is_some() {
            return text;
        }
        let key = self.tab_key();
        match self.app.upgrade() {
            Some(app) => app.update(cx, |app, _| app.with_tab_words(&key, text)),
            None => text,
        }
    }

    /// Esc closed the picker at that text only: any change reopens it. And
    /// it asks for the tabs afresh each time it opens.
    pub(crate) fn tab_text_changed(&mut self, cx: &mut Context<Self>) {
        let text = self.input.read(cx).value().to_string();
        if self
            .tab_picker
            .closed_at
            .as_deref()
            .is_some_and(|c| c != text)
        {
            self.tab_picker.closed_at = None;
        }
        if self.tab_query(cx).is_none() {
            self.tab_asked = false;
            self.tab_picker.selected = None;
        }
    }

    /// `ComposerView.paletteKey` for the picker: arrows, Tab, Return and Esc
    /// while it's open. With nothing to pick (none match, or no BrowserBear)
    /// Return sends and the arrows move the cursor, as if it weren't open;
    /// Esc still closes it.
    pub(crate) fn tab_palette_key(
        &mut self,
        key: PaletteKey,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        // With no @ picker open, the # thread picker may want it (thread_palette.rs).
        let Some(view) = self.tab_view(cx) else {
            return self.thread_palette_key(key, window, cx);
        };
        let matches = view.matches();
        if matches.is_empty() && key != PaletteKey::Escape {
            return false;
        }
        let text = self.input.read(cx).value().to_string();
        if let Some(tab) = tabs::handle_key(key, &matches, &mut self.tab_picker, &text) {
            self.pick_tab(tab, window, cx);
        }
        if matches!(key, PaletteKey::Up | PaletteKey::Down) {
            if let Some(index) = matches
                .iter()
                .position(|t| Some(t.tab_id) == self.tab_picker.selected)
            {
                self.tab_scroll.scroll_to_item(index);
            }
        }
        cx.notify();
        true
    }

    /// `ComposerView.pickTab`: puts the tab's reference where the @word was,
    /// as one undo, and lends the tab to the thread now (a new thread's once
    /// it's made). The row shows as lent here at once; the next list says
    /// how it went.
    pub(crate) fn pick_tab(
        &mut self,
        tab: BrowserTab,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(query) = self.tab_query(cx) else {
            return;
        };
        self.tab_picker = Default::default();
        let reference = tabs::reference(&tab) + " ";
        self.input.update(cx, |s, cx| {
            s.set_selected_range(query.start..query.end, cx);
            s.replace(reference, window, cx);
            s.focus(window, cx);
            crate::web_panels::keyboard_to_app(window);
        });
        let key = self.tab_key();
        let thread = self.thread_id.clone();
        if let Some(app) = self.app.upgrade() {
            app.update(cx, |app, cx| {
                let mut before = None;
                if let Some(Ok(list)) = app.tab_picker.tabs.get_mut(&key) {
                    if let Some(row) = list.iter_mut().find(|t| t.tab_id == tab.tab_id) {
                        before = Some((row.lent_to.clone(), row.allowed));
                        row.lent_to = Some(key.clone());
                        row.allowed = Some(true);
                    }
                }
                match thread {
                    Some(thread) => app.lend_tab(tab, thread, before, cx),
                    None => app.lend_when_made(tab),
                }
            });
        }
        cx.notify();
    }

    /// The picker's layer over the box, or None while it's closed.
    pub(crate) fn render_tab_palette(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let view = self.tab_view(cx)?;
        // Asked for afresh each time it opens, so a tab opened meanwhile is
        // there (also when the cursor moves into an @word).
        if !self.tab_asked {
            self.tab_asked = true;
            let (key, thread) = (view.key.clone(), view.thread.clone());
            if let Some(app) = self.app.upgrade() {
                cx.defer(move |cx| {
                    app.update(cx, |app, cx| app.load_browser_tabs(key, thread, cx))
                });
            }
        }
        let matches = view.matches();
        let picked = tabs::picked(&matches, &self.tab_picker).map(|t| t.tab_id);
        let zoom = style::zoomed(1.);
        let viewport = window.viewport_size();
        let width = f64::from(self.card_width.get() / zoom);
        let rows = match &view.tabs {
            Some(Ok(all)) => tabs::matches(all, "").len(),
            _ => 1,
        };
        let height = tabs::height(rows, f64::from(viewport.height / zoom));
        // No taller than the room over the box (the new-thread page).
        let room = f64::from(self.box_top.get() / zoom) - 16.;
        let height = if room > 0. {
            height.min(room.max(160.))
        } else {
            height
        };
        let content = match view.note() {
            Some(note) => div()
                .id("tab-palette-note")
                .test_support()
                .role(Role::ListItem)
                .aria_label(SharedString::from(note.clone()))
                .p(px(16.))
                .w_full()
                .text_size(px(size::LABEL + 1.))
                .text_color(style::secondary_text(cx))
                .child(note)
                .into_any_element(),
            None => {
                let mut list = v_flex().w_full();
                for tab in &matches {
                    let row = self.render_tab_row(
                        tab,
                        Some(tab.tab_id) == picked,
                        view.thread.as_deref().unwrap_or(NEW_THREAD_KEY),
                        cx,
                    );
                    list = list.child(row);
                }
                div()
                    .id("tab-palette-list")
                    .size_full()
                    .py(px(6.))
                    .overflow_y_scroll()
                    .track_scroll(&self.tab_scroll)
                    .child(list)
                    .into_any_element()
            }
        };
        let panel = div()
            .id("tab-palette")
            .size_full()
            .rounded(px(14.))
            .overflow_hidden()
            .bg(cx.theme().background)
            .border_1()
            .border_color(style::hairline(cx))
            .shadow_lg()
            .occlude()
            .child(content);
        Some(
            deferred(
                div()
                    .absolute()
                    .left_0()
                    .right_0()
                    .bottom_full()
                    .mb(px(8.))
                    .h(px(height as f32))
                    .child(
                        div()
                            .absolute()
                            .top_0()
                            .bottom_0()
                            .left_0()
                            .w(px(width as f32))
                            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                            .child(panel),
                    ),
            )
            .with_priority(2)
            .into_any_element(),
        )
    }

    fn render_tab_row(
        &mut self,
        tab: &BrowserTab,
        on: bool,
        thread: &str,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let tip: SharedString = tabs::tip(tab, thread).into();
        let title = tab.shown_title();
        let place = [Some(tab.host()), tab.profile.clone()]
            .into_iter()
            .flatten()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(" · ");
        let hint = tabs::hint(tab, thread);
        // Its favicon, once fetched; a globe meanwhile, or when there's none.
        let icon = tab.icon_url().and_then(|url| {
            let app = self.app.upgrade()?;
            match app.read(cx).tab_picker.favicons.get(&url) {
                Some(Favicon::Ready(image)) => Some(image.clone()),
                Some(_) => None,
                None => {
                    cx.defer(move |cx| app.update(cx, |app, cx| app.load_favicon(url, cx)));
                    None
                }
            }
        });
        let (fg, accent, hover) = (
            cx.theme().foreground,
            style::accent(cx).opacity(0.75),
            style::primary_opacity(cx, 0.05),
        );
        let text = if on { gpui_kit::white() } else { fg };
        let picture = match icon {
            Some(image) => img(ImageSource::Image(image))
                .size(px(16.))
                .rounded(px(3.))
                .object_fit(ObjectFit::Contain)
                .into_any_element(),
            None => div()
                .size(px(16.))
                .flex()
                .items_center()
                .justify_center()
                .opacity(0.5)
                .child(crate::icons::symbol("globe").size(px(14.)).text_color(text))
                .into_any_element(),
        };
        let picked = tab.clone();
        h_flex()
            .id(SharedString::from(format!("tab-row-{}", tab.tab_id)))
            .test_support()
            .role(Role::ListItem)
            .aria_label(SharedString::from(format!(
                "{title}, {place}{}",
                hint.map(|h| format!(", {h}")).unwrap_or_default()
            )))
            .w_full()
            .gap(px(10.))
            .px(px(14.))
            .py(px(6.))
            .cursor_pointer()
            .text_color(text)
            .when(on, |s| s.bg(accent))
            .when(!on, |s| s.hover(move |s| s.bg(hover)))
            .tip(tip)
            .on_click(cx.listener(move |this, _: &ClickEvent, window, cx| {
                this.pick_tab(picked.clone(), window, cx)
            }))
            .child(div().flex_none().child(picture))
            .child(
                v_flex()
                    .flex_1()
                    .min_w_0()
                    .gap(px(2.))
                    .child(
                        div()
                            .truncate()
                            .text_size(px(size::LABEL + 1.))
                            .font_weight(FontWeight::MEDIUM)
                            .child(title),
                    )
                    .child(
                        div()
                            .truncate()
                            .text_size(px(size::LABEL - 1.))
                            .opacity(0.7)
                            .child(place),
                    ),
            )
            // Whole: cut short it read "this tab…", the part that matters.
            .children(hint.map(|h| {
                div()
                    .flex_none()
                    .text_size(px(size::LABEL - 1.))
                    .opacity(0.75)
                    .child(h)
            }))
    }

    /// `dump`'s picker, while it's open.
    #[cfg(feature = "automation")]
    pub(crate) fn tab_palette_dump(&self, cx: &App) -> Value {
        let Some(view) = self.tab_view(cx) else {
            return Value::Null;
        };
        let matches = view.matches();
        let picked = tabs::picked(&matches, &self.tab_picker).map(|t| t.tab_id);
        let thread = view.thread.as_deref().unwrap_or(NEW_THREAD_KEY);
        let favicons = self.app.upgrade().map(|app| {
            let t = app.read(cx);
            matches
                .iter()
                .map(|tab| {
                    tab.icon_url().is_some_and(|u| {
                        matches!(t.tab_picker.favicons.get(&u), Some(Favicon::Ready(_)))
                    })
                })
                .collect::<Vec<_>>()
        });
        json!({
            "query": view.query.text,
            "tabs": matches.iter().enumerate().map(|(i, t)| json!({
                "tabId": t.tab_id,
                "title": t.shown_title(),
                "host": t.host(),
                "profile": t.profile,
                "hint": tabs::hint(t, thread),
                "favicon": favicons.as_ref().and_then(|f| f.get(i).copied()).unwrap_or(false),
            })).collect::<Vec<_>>(),
            "picked": picked,
            "note": view.note(),
        })
    }
}
