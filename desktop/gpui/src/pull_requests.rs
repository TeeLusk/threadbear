// A thread's GitHub pull requests (docs/protocol.md, "Pull request status"):
// the badge on its sidebar row and the cards at the top of its Highlights. A
// port of the Swift app's PRIcon, PRColors, PRBadgeView and
// PullRequestsSection; what they say comes from threadbear_core's
// pull_requests.rs.
//
// The icons are Hugeicons' stroke-rounded ones from the free set
// (`@hugeicons/core-free-icons` 4.4.0, MIT, hugeicons.com), kept here as SVG
// as the Swift app keeps them, drawn in whatever colour they're given. At
// sidebar and card sizes Hugeicons' 1.5 stroke is under a point, so they're
// drawn at 2, as the Swift app does below 18 points.
use crate::highlights::{icon, MenuAction, MenuItem, PaneRow, Palette, SidePane};
use crate::style;
use gpui_kit::*;
use gpui_kit::component::{h_flex, v_flex, ActiveTheme as _};
use crate::style::px;
use crate::tips::Tip as _;
use gpui_kit::prelude::*;
use std::collections::HashMap;
use threadbear_core::inbox::ThreadSummary;
use threadbear_core::pull_requests::{self as prs, Outcome, PrDetail, PrState, ReviewDecision, ThreadPr, Tone};

macro_rules! hugeicon {
    ($elements:literal) => {
        concat!(r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">"#, $elements, "</svg>").as_bytes()
    };
}

/// GitPullRequestIcon.
const PULL_REQUEST: &[u8] = hugeicon!(r#"<path d="M6 8L6 16"/><path d="M18 16V12C18 9.17156 18 7.75735 17.1213 6.87867C16.2426 5.99999 14.8284 5.99999 12 5.99999L11 5.99999M11 5.99999C11 5.29976 12.9943 3.99152 13.5 3.49999M11 5.99999C11 6.70022 12.9943 8.00846 13.5 8.49999"/><circle cx="6" cy="18" r="2"/><circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/>"#);
/// GitPullRequestDraftIcon.
const DRAFT: &[u8] = hugeicon!(r#"<path d="M6 8L6 16"/><circle cx="6" cy="18" r="2"/><circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M18.125 11H18M18.25 11C18.25 11.1381 18.1381 11.25 18 11.25C17.8619 11.25 17.75 11.1381 17.75 11C17.75 10.8619 17.8619 10.75 18 10.75C18.1381 10.75 18.25 10.8619 18.25 11Z"/><path d="M18.125 6H18M18.25 6C18.25 6.13807 18.1381 6.25 18 6.25C17.8619 6.25 17.75 6.13807 17.75 6C17.75 5.86193 17.8619 5.75 18 5.75C18.1381 5.75 18.25 5.86193 18.25 6Z"/>"#);
/// GitPullRequestClosedIcon.
const CLOSED: &[u8] = hugeicon!(r#"<path d="M6 8L6 16"/><path d="M18 11L18 16"/><circle cx="6" cy="18" r="2"/><circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M20 4L18 6M18 6L16 8M18 6L20 8M18 6L16 4"/>"#);
/// GitMergeIcon.
const MERGED: &[u8] = hugeicon!(r#"<path d="M7 20C8.10457 20 9 19.1046 9 18C9 16.8954 8.10457 16 7 16C5.89543 16 5 16.8954 5 18C5 19.1046 5.89543 20 7 20Z"/><path d="M7 8C8.10457 8 9 7.10457 9 6C9 4.89543 8.10457 4 7 4C5.89543 4 5 4.89543 5 6C5 7.10457 5.89543 8 7 8Z"/><path d="M17 14C18.1046 14 19 13.1046 19 12C19 10.8954 18.1046 10 17 10C15.8954 10 15 10.8954 15 12C15 13.1046 15.8954 14 17 14Z"/><path d="M7.02116 8.2793V15.4073M14.4113 12.0047L10.0193 12.0048C8.92158 12.0048 6.86182 11.1254 7.01818 8.78001"/>"#);
/// CheckmarkCircle02Icon.
const PASSED: &[u8] = hugeicon!(r#"<path d="M22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12Z"/><path d="M8 12.5L10.5 15L16 9"/>"#);
/// CancelCircleIcon.
const FAILED: &[u8] = hugeicon!(r#"<path d="M22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12Z"/><path d="M14.9994 15L12 12.0003M12 12.0003L9 9M12 12.0003L9.00064 15M12 12.0003L15 9"/>"#);
/// MinusSignCircleIcon.
const SKIPPED: &[u8] = hugeicon!(r#"<path d="M16 12L8 12"/><path d="M22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12Z"/>"#);
/// Loading03Icon.
const RUNNING: &[u8] = hugeicon!(r#"<path d="M12 3V6"/><path d="M12 18V21"/><path d="M21 12L18 12"/><path d="M6 12L3 12"/><path d="M18.3635 5.63672L16.2422 7.75804"/><path d="M7.75804 16.2422L5.63672 18.3635"/><path d="M18.3635 18.3635L16.2422 16.2422"/><path d="M7.75804 7.75804L5.63672 5.63672"/>"#);

/// The drawings by the names icons.rs looks them up under, so a PaneRow can
/// name one as it names a symbol.
pub(crate) fn icon_data(name: &str) -> Option<&'static [u8]> {
    Some(match name {
        "pr.open" => PULL_REQUEST,
        "pr.draft" => DRAFT,
        "pr.closed" => CLOSED,
        "pr.merged" => MERGED,
        "check.passed" => PASSED,
        "check.failed" => FAILED,
        "check.running" => RUNNING,
        "check.skipped" => SKIPPED,
        _ => return None,
    })
}

/// The shape for a pull request in this state.
fn state_icon(state: PrState) -> &'static str {
    match state {
        PrState::Merged => "pr.merged",
        PrState::Closed => "pr.closed",
        PrState::Draft => "pr.draft",
        PrState::Open | PrState::Unknown => "pr.open",
    }
}

/// The shape for the sidebar's tone: the worst PR's.
fn tone_icon(tone: Tone) -> &'static str {
    match tone {
        Tone::Merged => "pr.merged",
        Tone::Closed => "pr.closed",
        Tone::Draft => "pr.draft",
        Tone::Failing | Tone::Running | Tone::Open => "pr.open",
    }
}

/// The shape for one check's outcome; none for one this app doesn't know.
fn outcome_icon(outcome: Outcome) -> Option<&'static str> {
    Some(match outcome {
        Outcome::Passed => "check.passed",
        Outcome::Failed => "check.failed",
        Outcome::Running => "check.running",
        Outcome::Skipped => "check.skipped",
        Outcome::Unknown => return None,
    })
}

/// The tone's word, for the dump.
pub(crate) fn tone_word(tone: Tone) -> &'static str {
    match tone {
        Tone::Failing => "failing",
        Tone::Running => "running",
        Tone::Open => "open",
        Tone::Draft => "draft",
        Tone::Merged => "merged",
        Tone::Closed => "closed",
    }
}

// GitHub Primer's colours for pull requests, light and dark (`PRPalette`).
fn primer(cx: &App, light: u32, dark: u32) -> Hsla {
    rgb(if cx.theme().is_dark() { dark } else { light }).into()
}
fn green(cx: &App) -> Hsla { primer(cx, 0x1F883D, 0x3FB950) }
fn purple(cx: &App) -> Hsla { primer(cx, 0x8250DF, 0xA371F7) }
fn red(cx: &App) -> Hsla { primer(cx, 0xCF222E, 0xF85149) }
fn amber(cx: &App) -> Hsla { primer(cx, 0x9A6700, 0xD29922) }
fn grey(cx: &App) -> Hsla { primer(cx, 0x59636E, 0x9198A1) }

/// `PRTone.color`.
fn tone_color(tone: Tone, cx: &App) -> Hsla {
    match tone {
        Tone::Open => green(cx),
        Tone::Merged => purple(cx),
        Tone::Failing => red(cx),
        // Closed without merging: red, dimmed, as it's over and needs nothing.
        Tone::Closed => red(cx).opacity(0.6),
        Tone::Running => amber(cx),
        Tone::Draft => grey(cx),
    }
}

fn outcome_color(outcome: Outcome, cx: &App) -> Hsla {
    match outcome {
        Outcome::Passed => green(cx),
        Outcome::Failed => red(cx),
        Outcome::Running => amber(cx),
        Outcome::Skipped | Outcome::Unknown => grey(cx),
    }
}

/// `PRBadgeView`: on a thread's title line, the icon of the PR that most
/// needs attention in its colour, and how many when there's more than one.
/// None for a thread with none.
pub(crate) fn badge(t: &ThreadSummary, faint: Hsla, cx: &App) -> Option<AnyElement> {
    let list = t.prs();
    let tone = prs::tone(&list)?;
    let tip = prs::tooltip(&list);
    let side = style::size::SIDEBAR_META + 2.;
    Some(
        h_flex()
            .id(ElementId::Name(format!("prs-{}", t.id).into()))
            .flex_none()
            .items_center()
            .gap(px(3.))
            .ml(px(6.))
            .tip(tip.clone())
            .test_support()
            .aria_label(SharedString::from(tip))
            .child(icon(tone_icon(tone), side, tone_color(tone, cx)))
            .when(list.len() >= 2, |s| s.child(div().text_size(px(style::size::SIDEBAR_META)).text_color(faint).child(list.len().to_string())))
            .into_any_element(),
    )
}

/// The badge as the dump has it (`prs` on a row).
pub(crate) fn badge_dump(t: &ThreadSummary) -> serde_json::Value {
    let list = t.prs();
    match prs::tone(&list) {
        Some(tone) => serde_json::json!({ "tone": tone_word(tone), "count": list.len(), "tip": prs::tooltip(&list) }),
        None => serde_json::Value::Null,
    }
}

/// What the pane keeps for the cards: the runner's check lists, and what
/// Mike's done to each card.
#[derive(Default)]
pub(crate) struct PrsState {
    /// `threads.prs`'s last answer per thread, by url.
    details: HashMap<String, HashMap<String, PrDetail>>,
    /// The summary's looks each thread's answer was asked for, so a new
    /// look (`checkedAt` moves) asks again.
    asked: HashMap<String, String>,
    /// Mike's own open or shut, per PR; until then, open when one failed.
    checks_open: HashMap<String, bool>,
    /// The look "Fix failing checks" was sent on, per PR, so it can't go
    /// twice before the runner has looked again.
    fix_sent: HashMap<String, String>,
}

/// Every PR's url and look, to tell when the runner has looked again.
fn looks_key(list: &[ThreadPr]) -> String {
    list.iter().map(|p| format!("{}@{}", p.url, p.checked_at_text.as_deref().unwrap_or(""))).collect::<Vec<_>>().join(" ")
}

fn look(pr: &ThreadPr) -> String {
    pr.checked_at_text.clone().unwrap_or_default()
}

impl SidePane {
    /// The summary's PRs, with what the runner's answer adds.
    pub(crate) fn pr_cards(&self, thread: &ThreadSummary) -> Vec<PrDetail> {
        let details = self.prs.details.get(&thread.id);
        thread
            .prs()
            .into_iter()
            .map(|pr| {
                let mut d = details.and_then(|d| d.get(&pr.url)).cloned().unwrap_or_else(|| PrDetail::of(pr.clone()));
                d.pr = pr;
                d
            })
            .collect()
    }

    /// Asks for the check lists again when the runner has looked again (or
    /// for the first time). An older runner answers -32601, and the cards
    /// keep to what the summary says.
    pub(crate) fn refresh_prs(&mut self, thread: &ThreadSummary, cx: &mut Context<Self>) {
        let list = thread.prs();
        if list.is_empty() {
            return;
        }
        let key = looks_key(&list);
        if self.prs.asked.get(&thread.id) == Some(&key) {
            return;
        }
        self.prs.asked.insert(thread.id.clone(), key);
        let (client, id) = (self.client.clone(), thread.id.clone());
        cx.spawn(async move |this, cx| {
            let res = crate::call(client, "threads.prs", serde_json::json!({ "threadId": id })).await;
            this.update(cx, |t, cx| match res {
                Ok(v) => {
                    let fresh: HashMap<String, PrDetail> = PrDetail::list(&v).into_iter().map(|d| (d.pr.url.clone(), d)).collect();
                    if t.prs.details.get(&id) != Some(&fresh) {
                        t.prs.details.insert(id, fresh);
                        cx.notify();
                    }
                }
                Err(e) if e.code == -32601 => {}
                Err(e) => threadbear_client::log::write("rpc", &format!("threads.prs failed: {}", e.message)),
            })
            .ok();
        })
        .detach();
    }

    fn checks_open(&self, d: &PrDetail) -> bool {
        !d.check_list.is_empty() && self.prs.checks_open.get(&d.pr.url).copied().unwrap_or(d.pr.checks.as_ref().is_some_and(|c| c.state == prs::ChecksState::Failing))
    }

    fn fix_sent(&self, pr: &ThreadPr) -> bool {
        self.prs.fix_sent.get(&pr.url) == Some(&look(pr))
    }

    /// The ••• menu (`menuItems`): Open on GitHub, Copy link, and on an open
    /// or draft PR whose checks fail, Fix failing checks.
    pub(crate) fn pr_menu(&self, pr: &ThreadPr) -> Vec<MenuItem> {
        let mut items = vec![];
        if let Some(url) = prs::web_link(Some(&pr.url)) {
            items.push(MenuItem::action("Open on GitHub", "arrow.up.forward", MenuAction::OpenUrl { url: url.to_owned() }));
        }
        items.push(MenuItem::action("Copy link", "link", MenuAction::Copy { text: pr.url.clone() }));
        if prs::can_fix_checks(pr) {
            items.push(MenuItem::separator());
            if self.fix_sent(pr) {
                items.push(MenuItem::disabled("Asked the thread to fix them", "checkmark"));
            } else {
                items.push(MenuItem::action("Fix failing checks", "wrench.and.screwdriver", MenuAction::FixChecks { url: pr.url.clone() }));
            }
        }
        items
    }

    /// "Fix failing checks": sends the thread the fix through the composer's
    /// own send path, shown as asked straight away, and back to the button
    /// if the runner turns it away (the error bar says why).
    pub(crate) fn fix_checks(&mut self, url: String, thread: &ThreadSummary, cx: &mut Context<Self>) {
        let Some(pr) = thread.prs().into_iter().find(|p| p.url == url) else { return };
        if self.fix_sent(&pr) || !prs::can_fix_checks(&pr) {
            return;
        }
        let Some(app) = self.app.upgrade() else { return };
        let Some(pane) = app.read(cx).pane_for(&thread.id, cx) else {
            self.note_error("Open the thread to send it the fix.".into(), cx);
            return;
        };
        if let Some(why) = pane.read(cx).cant_send_now() {
            self.note_error(why, cx);
            return;
        }
        let sent_on = look(&pr);
        self.prs.fix_sent.insert(url.clone(), sent_on.clone());
        let me = cx.entity().downgrade();
        let failed: crate::thread::SendFailed = Box::new(move |cx| {
            me.update(cx, |t, cx| {
                if t.prs.fix_sent.get(&url) == Some(&sent_on) {
                    t.prs.fix_sent.remove(&url);
                    cx.notify();
                }
            })
            .ok();
        });
        let text = prs::fix_checks_prompt(&pr.url);
        pane.update(cx, |p, cx| p.send_message(text, Vec::new(), serde_json::Value::Null, None, WeakEntity::new_invalid(), Some(failed), cx));
        cx.notify();
    }

    /// The Pull requests section: its heading and a card for each PR.
    pub(crate) fn pr_section(&mut self, thread: &ThreadSummary, p: Palette, cx: &mut Context<Self>) -> Option<AnyElement> {
        let cards = self.pr_cards(thread);
        if cards.is_empty() {
            return None;
        }
        self.refresh_prs(thread, cx);
        let folded = self.is_folded(PULL_REQUESTS);
        let mut list = v_flex().child(self.heading(
            crate::highlights::Heading { key: PULL_REQUESTS.to_owned(), title: "Pull requests".into(), icon: Some(icon("arrow.triangle.pull", 11., p.secondary).into_any_element()), count: Some(cards.len()), folded, foldable: true, accessory: None },
            p,
            cx,
        ));
        if !folded {
            let mut stack = v_flex().gap(px(8.));
            for d in &cards {
                stack = stack.child(self.pr_card(d, p, cx));
            }
            list = list.child(stack);
        }
        Some(list.into_any_element())
    }

    /// `PullRequestCard`: its title (a click opens it), `app #691 · Open`
    /// under it and a ••• menu, then its checks, review, conflicts, and when
    /// it was last looked at.
    fn pr_card(&mut self, d: &PrDetail, p: Palette, cx: &mut Context<Self>) -> AnyElement {
        let pr = &d.pr;
        let key = pr.url.clone();
        let tone = prs::tone(std::slice::from_ref(pr)).unwrap_or(Tone::Draft);
        let title = if pr.title.is_empty() { format!("#{}", pr.number) } else { pr.title.clone() };
        let more = {
            let pr = pr.clone();
            let anchor = std::rc::Rc::new(std::cell::Cell::new(None::<Bounds<Pixels>>));
            let measured = anchor.clone();
            div()
                .relative()
                .flex_none()
                .size(px(24.))
                .mr(px(6.))
                .child(canvas(move |bounds, _, _| measured.set(Some(bounds)), |_, _, _, _| {}).absolute().size_full())
                .child(
                    crate::highlights::tipped(div().id(SharedString::from(format!("pr-more-{key}"))).size_full().flex().items_center().justify_center().rounded(px(5.)).hover(|s| s.bg(p.hover)).cursor_pointer().child(icon("ellipsis", 12., p.secondary)), "More")
                        .on_click(cx.listener(move |this, ev: &ClickEvent, window, cx| {
                            let at = anchor.get().map(|b| point(b.left(), b.bottom() + px(4.))).unwrap_or(ev.position());
                            let items = this.pr_menu(&pr);
                            this.open_menu(items, at, window, cx);
                        })),
                )
                .into_any_element()
        };
        let open_url = prs::web_link(Some(&pr.url)).map(str::to_owned);
        let menu_pr = pr.clone();
        let mut header = PaneRow::new(SharedString::from(format!("pr-{key}")), title)
            .icon(state_icon(pr.state))
            .tinted(Some(tone_color(tone, cx)))
            .detail(Some(prs::subtitle(pr)))
            .tip(format!("Open {} #{}", pr.repo, pr.number))
            .on_menu(move |this, pos, window, cx| {
                let items = this.pr_menu(&menu_pr);
                this.open_menu(items, pos, window, cx);
            });
        if let Some(url) = open_url {
            header = header.on_click(move |this, _, cx| this.follow_link(&url, cx));
        }
        let mut card = v_flex().py(px(4.)).child(h_flex().items_center().child(div().flex_1().min_w_0().child(header.render(p, cx))).child(more));

        if let Some(line) = prs::checks_line(pr) {
            let list = prs::sorted_checks(&d.check_list);
            let open = self.checks_open(d);
            let row = PaneRow::new(SharedString::from(format!("pr-checks-{key}")), line.clone()).quiet().reserves_icon(true);
            let row = if list.is_empty() {
                row.tip(line)
            } else {
                let url = key.clone();
                row.icon(if open { "chevron.down" } else { "chevron.right" }).tip(if open { "Hide the checks" } else { "Show each check" }).on_click(move |this, _, cx| {
                    this.prs.checks_open.insert(url.clone(), !open);
                    cx.notify();
                })
            };
            card = card.child(row.render(p, cx));
            if open {
                for (i, check) in list.iter().enumerate() {
                    let word = prs::outcome_word(check.outcome);
                    let link = prs::web_link(check.url.as_deref()).map(str::to_owned);
                    let mut row = PaneRow::new(SharedString::from(format!("pr-check-{key}-{i}")), check.name.clone())
                        .icon_opt(outcome_icon(check.outcome))
                        .tinted(Some(outcome_color(check.outcome, cx)))
                        .trailing(prs::check_trailing(check))
                        .detail(check.workflow.clone())
                        .indent()
                        .reserves_icon(true)
                        .tip(if link.is_some() { format!("{word}. Click to open its run.") } else { word.to_owned() });
                    if let Some(url) = link {
                        row = row.on_click(move |this, _, cx| this.follow_link(&url, cx));
                    }
                    card = card.child(row.render(p, cx));
                }
            }
        }
        if let Some(review) = prs::review_line(d) {
            let (symbol, color) = match pr.review.as_ref().map(|r| r.decision) {
                Some(ReviewDecision::Approved) => ("bubble.left", Some(green(cx))),
                Some(ReviewDecision::Changes) => ("bubble.left", Some(red(cx))),
                _ => ("eye", None),
            };
            card = card.child(PaneRow::new(SharedString::from(format!("pr-review-{key}")), review).icon(symbol).tinted(color).render(p, cx));
        }
        if pr.conflicts {
            card = card.child(div().text_color(red(cx)).child(PaneRow::new(SharedString::from(format!("pr-conflicts-{key}")), conflicts_line(d)).icon("exclamationmark.triangle").tinted(Some(red(cx))).render(p, cx)));
        }
        let now = threadbear_core::sidebar::local_now();
        card = card.child(div().pl(px(crate::highlights::LEADING + 24. - crate::highlights::OUTER_INSET)).pt(px(2.)).pb(px(6.)).text_size(px(style::size::SMALL)).text_color(p.faint).child(prs::checked_line(pr.checked_at, &now)));
        let border = style::card_border(cx);
        div()
            .px(px(crate::highlights::OUTER_INSET))
            .child(card.rounded(px(10.)).bg(style::primary_opacity(cx, 0.035)).border(px(0.5)).border_color(border))
            .into_any_element()
    }

    /// The cards as the dump has them: a row each, its lines under its title.
    #[cfg(feature = "automation")]
    pub(crate) fn pr_dump_rows(&self, thread: &ThreadSummary) -> Vec<serde_json::Value> {
        self.pr_cards(thread)
            .iter()
            .map(|d| {
                let pr = &d.pr;
                let mut lines: Vec<String> = vec![];
                lines.extend(prs::checks_line(pr));
                let checks: Vec<String> = if self.checks_open(d) { prs::sorted_checks(&d.check_list).iter().map(|c| format!("{}: {}", c.name, prs::outcome_word(c.outcome))).collect() } else { vec![] };
                lines.extend(prs::review_line(d));
                if pr.conflicts {
                    lines.push(conflicts_line(d));
                }
                lines.push(prs::checked_line(pr.checked_at, &threadbear_core::sidebar::local_now()));
                let tone = prs::tone(std::slice::from_ref(pr)).unwrap_or(Tone::Draft);
                serde_json::json!({ "title": if pr.title.is_empty() { format!("#{}", pr.number) } else { pr.title.clone() }, "detail": prs::subtitle(pr), "symbol": state_icon(pr.state), "trailing": tone_word(tone), "lines": lines, "checks": checks })
            })
            .collect()
    }
}

fn conflicts_line(d: &PrDetail) -> String {
    format!("Merge conflicts with {}", if d.base_ref.is_empty() { "the base branch" } else { &d.base_ref })
}

/// The section's fold key (`HighlightFold.pullRequests`).
pub(crate) const PULL_REQUESTS: &str = "pullRequests";
