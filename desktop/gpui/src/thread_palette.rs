// The # picker over the message box: Tyler's threads, those whose title,
// folder or id has what's typed after the # (threadbear_core::thread_mentions).
// Arrows move, Return or Tab or a click picks one, Esc closes it. Picking one
// puts the thread's id where the #word was, so the agent can read or message
// that thread. Drawn as the @ tab picker is (tab_palette.rs), which, like the
// slash palette, goes first.
use crate::composer::Composer;
use crate::style::{self, size};
use crate::tips::Tip as _;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::{h_flex, v_flex, ActiveTheme as _};
use gpui_kit::prelude::*;
use gpui_kit::*;
// Shadows gpui's px, so sizes here follow the app's zoom (style.rs).
use crate::style::px;
#[cfg(feature = "automation")]
use serde_json::{json, Value};
use std::sync::Arc;
use threadbear_core::inbox::ThreadSummary;
use threadbear_core::slash::PaletteKey;
use threadbear_core::tab_mentions::height;
use threadbear_core::thread_mentions::{self as mentions, Query};

impl Composer {
    /// The "#word" before the cursor while the picker is open: not while the
    /// slash palette or the @ tab picker is, not with a selection, and not
    /// once Esc closed it at this text.
    fn thread_query(&self, cx: &App) -> Option<Query> {
        let state = self.input.read(cx);
        let text = state.value().to_string();
        if self.thread_picker.closed_at.as_deref() == Some(text.as_str())
            || self.palette_typed(&text).is_some()
        {
            return None;
        }
        if !state.selected_range().is_empty() {
            return None;
        }
        mentions::query(&text, state.cursor())
    }

    /// The threads matching what's typed, read each time it's drawn.
    fn thread_matches(&self, query: &Query, cx: &App) -> Vec<Arc<ThreadSummary>> {
        let Some(app) = self.app.upgrade() else {
            return vec![];
        };
        let all: Vec<Arc<ThreadSummary>> = app.read(cx).threads.values().cloned().collect();
        mentions::matches(&all, &query.text, self.thread_id.as_deref())
    }

    /// Esc closed the picker at that text only: any change reopens it.
    pub(crate) fn thread_text_changed(&mut self, cx: &mut Context<Self>) {
        let text = self.input.read(cx).value().to_string();
        if self
            .thread_picker
            .closed_at
            .as_deref()
            .is_some_and(|c| c != text)
        {
            self.thread_picker.closed_at = None;
        }
        if self.thread_query(cx).is_none() {
            self.thread_picker.selected = None;
        }
    }

    /// Arrows, Tab, Return and Esc while the picker is open. With nothing to
    /// pick, Return sends and the arrows move the cursor, as if it weren't
    /// open; Esc still closes it.
    pub(crate) fn thread_palette_key(
        &mut self,
        key: PaletteKey,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let Some(query) = self.thread_query(cx) else {
            return false;
        };
        let matches = self.thread_matches(&query, cx);
        if matches.is_empty() && key != PaletteKey::Escape {
            return false;
        }
        let text = self.input.read(cx).value().to_string();
        if let Some(thread) = mentions::handle_key(key, &matches, &mut self.thread_picker, &text) {
            self.pick_thread(thread, window, cx);
        }
        if matches!(key, PaletteKey::Up | PaletteKey::Down) {
            if let Some(index) = matches
                .iter()
                .position(|t| self.thread_picker.selected.as_deref() == Some(t.id.as_str()))
            {
                self.thread_scroll.scroll_to_item(index);
            }
        }
        cx.notify();
        true
    }

    /// Puts the thread's id where the #word was, as one undo.
    pub(crate) fn pick_thread(
        &mut self,
        thread: Arc<ThreadSummary>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(query) = self.thread_query(cx) else {
            return;
        };
        self.thread_picker = Default::default();
        let reference = mentions::reference(&thread) + " ";
        self.input.update(cx, |s, cx| {
            s.set_selected_range(query.start..query.end, cx);
            s.replace(reference, window, cx);
            s.focus(window, cx);
            crate::web_panels::keyboard_to_app(window);
        });
        cx.notify();
    }

    /// The picker's layer over the box, or None while it's closed.
    pub(crate) fn render_thread_palette(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let query = self.thread_query(cx)?;
        let matches = self.thread_matches(&query, cx);
        let picked = mentions::picked(&matches, &self.thread_picker).map(|t| t.id.clone());
        let zoom = style::zoomed(1.);
        let viewport = window.viewport_size();
        let width = f64::from(self.card_width.get() / zoom);
        let height = height(matches.len().max(1), f64::from(viewport.height / zoom));
        // No taller than the room over the box (the new-thread page).
        let room = f64::from(self.box_top.get() / zoom) - 16.;
        let height = if room > 0. {
            height.min(room.max(160.))
        } else {
            height
        };
        let content = if matches.is_empty() {
            let note = mentions::empty_text(&query.text);
            div()
                .id("thread-palette-note")
                .test_support()
                .role(Role::ListItem)
                .aria_label(SharedString::from(note.clone()))
                .p(px(16.))
                .w_full()
                .text_size(px(size::LABEL + 1.))
                .text_color(style::secondary_text(cx))
                .child(note)
                .into_any_element()
        } else {
            let mut list = v_flex().w_full();
            for thread in &matches {
                let row = self.render_thread_row(
                    thread,
                    picked.as_deref() == Some(thread.id.as_str()),
                    cx,
                );
                list = list.child(row);
            }
            div()
                .id("thread-palette-list")
                .size_full()
                .py(px(6.))
                .overflow_y_scroll()
                .track_scroll(&self.thread_scroll)
                .child(list)
                .into_any_element()
        };
        let panel = div()
            .id("thread-palette")
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

    fn render_thread_row(
        &mut self,
        thread: &Arc<ThreadSummary>,
        on: bool,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let title = mentions::shown_title(thread);
        let folder = mentions::folder(thread);
        let place = if thread.archived_at.is_some() {
            format!("{folder} · archived")
        } else {
            folder
        };
        let (fg, accent, hover) = (
            cx.theme().foreground,
            style::accent(cx).opacity(0.75),
            style::primary_opacity(cx, 0.05),
        );
        let text = if on { gpui_kit::white() } else { fg };
        let tip: SharedString =
            format!("Puts this thread's id ({}) in the message", thread.id).into();
        let picked = thread.clone();
        h_flex()
            .id(SharedString::from(format!("thread-row-{}", thread.id)))
            .test_support()
            .role(Role::ListItem)
            .aria_label(SharedString::from(format!("{title}, {place}")))
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
                this.pick_thread(picked.clone(), window, cx)
            }))
            .child(
                div()
                    .flex_none()
                    .size(px(16.))
                    .flex()
                    .items_center()
                    .justify_center()
                    .opacity(0.5)
                    .child(
                        crate::icons::symbol("bubble.left")
                            .size(px(14.))
                            .text_color(text),
                    ),
            )
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
    }

    /// `dump`'s picker, while it's open.
    #[cfg(feature = "automation")]
    pub(crate) fn thread_palette_dump(&self, cx: &App) -> Value {
        let Some(query) = self.thread_query(cx) else {
            return Value::Null;
        };
        let matches = self.thread_matches(&query, cx);
        let picked = mentions::picked(&matches, &self.thread_picker).map(|t| t.id.clone());
        json!({
            "query": query.text,
            "threads": matches.iter().map(|t| json!({ "id": t.id, "title": mentions::shown_title(t), "folder": mentions::folder(t) })).collect::<Vec<_>>(),
            "picked": picked,
            "note": matches.is_empty().then(|| mentions::empty_text(&query.text)),
        })
    }
}
