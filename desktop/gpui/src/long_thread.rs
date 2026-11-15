// The long thread card, just above the message box like the refusal offer
// (Swift `LongThreadOffer`; docs/protocol.md, "Long threads"). Past the
// runner's contextNudge levels it offers Compact (/compact), Continue in a
// new thread (`threads.continueFresh`) and Not now; while the handoff is
// written it says so with a spinner, and after it, where the thread carried
// on, with Open. What it shows is threadbear_core::long_thread's; Not now is
// kept per thread in desktop-settings.json's `longThreadDismissals`. In a
// file of its own so the feature stays in one place.
use crate::app::Threadbear;
use crate::call;
use crate::spinner::Spinner;
use crate::style::{self, px};
use gpui_kit::assets::IconName;
use gpui_kit::base::TestSupportExt as _;
use gpui_kit::component::{h_flex, v_flex, Sizable as _};
use gpui_kit::prelude::*;
use gpui_kit::*;
use serde_json::json;
use threadbear_core::long_thread::{self, LongThread};

/// The busy keys in `chip_busy`, one per button, as Swift's `LongThreadBusy`.
fn compact_key(id: &str) -> String {
    format!("longCompact/{id}")
}
fn continue_key(id: &str) -> String {
    format!("longContinue/{id}")
}

/// Roughly how wide the card is with its words and buttons on one line, at
/// 100%: wider than the box, the buttons go under the words (Swift's
/// ViewThatFits). Generous, so a line that only just fits stacks instead.
fn one_line_width(message: &str, buttons: &[&str]) -> f32 {
    let words = message.chars().count() as f32 * 6.5;
    let buttons: f32 = buttons.iter().map(|b| b.chars().count() as f32 * 7.5 + 22.).sum::<f32>() + buttons.len() as f32 * 8.;
    words + buttons + 12. + 24.
}

impl Threadbear {
    /// The card for the open thread `thread_id`, if it has one now.
    pub(crate) fn long_thread_card(&self, thread_id: &str) -> Option<LongThread> {
        let thread = self.threads.get(thread_id).filter(|_| self.selected.as_deref() == Some(thread_id))?;
        let dismissed = self.settings.saved.long_thread_dismissals.as_ref().and_then(|all| all.get(thread_id));
        LongThread::card(thread, dismissed)
    }

    /// The dump's `composer.longThread`: the card's words and its buttons as
    /// they read, for the specs.
    pub(crate) fn long_thread_dump(&self, thread_id: &str) -> Option<serde_json::Value> {
        let card = self.long_thread_card(thread_id)?;
        let buttons: Vec<&str> = match &card {
            LongThread::Suggest { .. } => vec![
                if self.chip_busy.contains(&compact_key(thread_id)) { "Compacting…" } else { "Compact" },
                if self.chip_busy.contains(&continue_key(thread_id)) { "Starting…" } else { "Continue in a new thread" },
                "Not now",
            ],
            LongThread::Writing => vec![],
            LongThread::Continued(_) => vec!["Open", "Not now"],
        };
        Some(json!({ "message": card.message(), "buttons": buttons }))
    }

    pub(crate) fn long_thread_offer(app: &Entity<Threadbear>, thread_id: &str, width: f32, cx: &App) -> Option<AnyElement> {
        let t = app.read(cx);
        let card = t.long_thread_card(thread_id)?;
        let compacting = t.chip_busy.contains(&compact_key(thread_id));
        let continuing = t.chip_busy.contains(&continue_key(thread_id));
        let tokens = t.threads.get(thread_id).and_then(|s| s.context_tokens);
        Some(render(app.downgrade(), thread_id.to_owned(), card, compacting, continuing, tokens, width, cx))
    }

    /// Compact: sends /compact, the busy key held until the runner takes it.
    pub(crate) fn compact_long_thread(&mut self, thread: String, cx: &mut Context<Self>) {
        self.long_thread_call(compact_key(&thread), "threads.send", json!({ "threadId": thread, "text": "/compact" }), &thread, cx);
    }

    /// Continue in a new thread: the runner asks the agent for a handoff
    /// and starts the new thread with it.
    pub(crate) fn continue_long_thread(&mut self, thread: String, cx: &mut Context<Self>) {
        self.long_thread_call(continue_key(&thread), "threads.continueFresh", json!({ "threadId": thread }), &thread, cx);
    }

    fn long_thread_call(&mut self, key: String, method: &'static str, mut params: serde_json::Value, thread: &str, cx: &mut Context<Self>) {
        if self.chip_busy.contains(&compact_key(thread)) || self.chip_busy.contains(&continue_key(thread)) {
            return;
        }
        // The runner it's shown on, as every send says it.
        if let Some(runner) = self.threads.get(thread).and_then(|t| t.runner_id.clone()) {
            params["runnerId"] = json!(runner);
        }
        self.chip_busy.insert(key.clone());
        cx.notify();
        let client = self.client.clone();
        cx.spawn(async move |this, cx| {
            let res = call(client, method, params).await;
            this.update(cx, |this, cx| {
                this.chip_busy.remove(&key);
                if let Err(e) = res {
                    this.show_error(e.message, cx);
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// Not now: hides the card for this thread until it gets longer still.
    pub(crate) fn dismiss_long_thread(&mut self, thread: String, dismissal: long_thread::Dismissal, cx: &mut Context<Self>) {
        let all = self.settings.saved.long_thread_dismissals.get_or_insert_with(Default::default);
        long_thread::remember(all, &thread, dismissal);
        self.settings.save();
        cx.notify();
    }
}

fn button(id: impl Into<ElementId>, label: &'static str, tip: &'static str, primary: bool, enabled: bool, cx: &App, click: Option<Box<dyn Fn(&ClickEvent, &mut Window, &mut App) + 'static>>) -> AnyElement {
    let el = div()
        .id(id)
        .flex_none()
        .px(px(10.))
        .py(px(4.))
        .rounded(px(6.))
        .when(primary, |s| s.bg(style::primary_opacity(cx, 0.1)))
        .when(!primary, |s| s.border_1().border_color(style::hairline(cx)))
        .when(!enabled, |s| s.opacity(0.5))
        .when(enabled, |s| s.cursor_pointer())
        .when_some(click.filter(|_| enabled), |s, click| s.on_click(move |e, w, cx| click(e, w, cx)))
        .child(label);
    let shown: SharedString = tip.into();
    crate::tips::Tip::tip(crate::a11y::A11yRole::a11y_role(el.test_support(), gpui_kit::Role::Button).aria_label(shown.clone()), shown).into_any_element()
}

#[allow(clippy::too_many_arguments)]
fn render(app: WeakEntity<Threadbear>, id: String, card: LongThread, compacting: bool, continuing: bool, tokens: Option<i64>, width: f32, cx: &App) -> AnyElement {
    let (hairline, fill, secondary) = (style::hairline(cx), style::card_background(cx), style::secondary_text(cx));
    let either = compacting || continuing;
    let mut buttons = h_flex().flex_none().gap(px(8.)).items_center();
    let not_now = {
        let (app, id, dismissal) = (app.clone(), id.clone(), card.dismissal(tokens));
        button("long-thread-not-now", "Not now", "Hide this for this thread until it gets longer still", false, true, cx, Some(Box::new(move |_: &ClickEvent, _: &mut Window, cx: &mut App| {
            if let Some(app) = app.upgrade() {
                app.update(cx, |this, cx| this.dismiss_long_thread(id.clone(), dismissal, cx));
            }
        })))
    };
    match &card {
        LongThread::Suggest { .. } => {
            let compact = {
                let (app, id) = (app.clone(), id.clone());
                button("long-thread-compact", if compacting { "Compacting…" } else { "Compact" }, "Send /compact: the agent sums up the conversation so far and carries on from the summary", true, !either, cx, Some(Box::new(move |_: &ClickEvent, _: &mut Window, cx: &mut App| {
                    if let Some(app) = app.upgrade() {
                        app.update(cx, |this, cx| this.compact_long_thread(id.clone(), cx));
                    }
                })))
            };
            let fresh = {
                let (app, id) = (app.clone(), id.clone());
                button("long-thread-continue", if continuing { "Starting…" } else { "Continue in a new thread" }, "Ask the agent for a short handoff, then start a new thread with it in this folder, on the same model and pool", true, !either, cx, Some(Box::new(move |_: &ClickEvent, _: &mut Window, cx: &mut App| {
                    if let Some(app) = app.upgrade() {
                        app.update(cx, |this, cx| this.continue_long_thread(id.clone(), cx));
                    }
                })))
            };
            buttons = buttons.child(compact).child(fresh).child(not_now);
        }
        LongThread::Writing => {
            buttons = buttons.child(div().size(px(14.)).child(Spinner::new().icon(IconName::LoaderCircle).color(secondary).with_size(px(14.))));
        }
        LongThread::Continued(next) => {
            let (app, next) = (app.clone(), next.thread_id.clone());
            let open = button("long-thread-open", "Open", "Go to the thread this one carried on in", true, true, cx, Some(Box::new(move |_: &ClickEvent, window: &mut Window, cx: &mut App| {
                if let Some(app) = app.upgrade() {
                    app.update(cx, |this, cx| {
                        this.reveal_thread(&next, cx);
                        this.open(next.clone(), window, cx);
                    });
                }
            })));
            buttons = buttons.child(open).child(not_now);
        }
    }
    let message = div().text_color(secondary).child(card.message());
    let base = |d: Div| d.flex_none().w_full().mb(px(8.)).p(px(12.)).rounded(px(12.)).bg(fill).border_1().border_color(hairline).text_size(px(style::size::LABEL));
    let labels: &[&str] = match &card {
        LongThread::Suggest { .. } => &["Continue in a new thread", "Compacting…", "Not now"],
        LongThread::Writing => &[""],
        LongThread::Continued(_) => &["Open", "Not now"],
    };
    if width >= style::zoomed(one_line_width(&card.message(), labels)) {
        base(h_flex()).gap(px(12.)).items_center().child(message.flex_1().min_w_0()).child(buttons).into_any_element()
    } else {
        base(v_flex()).gap(px(8.)).items_start().child(message).child(buttons).into_any_element()
    }
}
