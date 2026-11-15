// What BrowserBear's Annotate sends back from a page in Tyler's own Chrome:
// the comment, what was marked, and the page it was on (BrowserBear's
// extension/annotation.js), a port of ThreadbearCore's BrowserAnnotation.swift.
// Attach leaves it in `annotations/<session>.json` in BrowserBear's folder
// with a screenshot beside it, and opens
// `threadbear://thread/<id>?annotation=<session>` (thread_link.rs); the app
// puts the words below and the screenshot after that thread's draft, unsent
// (desktop/gpui/src/browser_annotations.rs). The page wrote it, so every list
// and string is bounded before it goes near a message box.
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    fn valid(&self) -> bool {
        [self.x, self.y, self.width, self.height].iter().all(|v| finite_and_small(*v)) && self.width >= 0. && self.height >= 0.
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Element {
    pub selector: String,
    pub tag_name: String,
    #[serde(rename = "outerHTML")]
    pub outer_html: String,
    pub text: String,
    pub styles: std::collections::HashMap<String, String>,
    pub rect: Rect,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Stroke {
    pub points: Vec<Point>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Viewport {
    pub width: f64,
    pub height: f64,
    pub scroll_x: f64,
    pub scroll_y: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct BrowserAnnotation {
    pub url: String,
    pub title: String,
    pub comment: String,
    pub elements: Vec<Element>,
    pub regions: Vec<Rect>,
    pub strokes: Vec<Stroke>,
    pub viewport: Viewport,
}

/// The most BrowserBear's whole file may be (the annotation and its few
/// fields around it).
pub const MAX_FILE: usize = 600 * 1024;
/// The most the annotation itself may be.
pub const MAX_ANNOTATION: usize = 512 * 1024;

fn finite_and_small(v: f64) -> bool {
    v.is_finite() && v.abs() <= 10_000_000.
}

fn len(s: &str) -> usize {
    s.chars().count()
}

/// BrowserBear's file: which thread it's for, whether a screenshot was taken,
/// and the annotation, still to be checked (`decode`).
#[derive(Debug, Deserialize)]
pub struct Saved {
    pub thread: String,
    #[serde(default)]
    pub screenshot: Option<bool>,
    #[serde(default)]
    pub annotation: serde_json::Value,
}

impl Saved {
    pub fn read(data: &[u8]) -> Option<Saved> {
        if data.len() > MAX_FILE {
            return None;
        }
        serde_json::from_slice(data).ok()
    }
}

impl BrowserAnnotation {
    /// From BrowserBear's file, refusing anything oversized or malformed.
    pub fn decode(data: &[u8]) -> Option<Self> {
        if data.len() > MAX_ANNOTATION {
            return None;
        }
        let value: Self = serde_json::from_slice(data).ok()?;
        value.bounded().then_some(value)
    }

    /// `decode` of the annotation inside BrowserBear's file.
    pub fn from_value(value: &serde_json::Value) -> Option<Self> {
        Self::decode(&serde_json::to_vec(value).ok()?)
    }

    fn bounded(&self) -> bool {
        let v = &self.viewport;
        len(&self.url) <= 8192
            && len(&self.title) <= 1024
            && len(&self.comment) <= 16000
            && self.elements.len() <= 20
            && self.regions.len() <= 20
            && self.strokes.len() <= 100
            && !(self.elements.is_empty() && self.regions.is_empty() && self.strokes.is_empty())
            && self.strokes.iter().map(|s| s.points.len()).sum::<usize>() <= 20_000
            && [v.width, v.height, v.scroll_x, v.scroll_y].iter().all(|n| finite_and_small(*n))
            && v.width > 0.
            && v.height > 0.
            && self.elements.iter().all(|e| len(&e.selector) <= 2048 && len(&e.tag_name) <= 128 && len(&e.outer_html) <= 16000 && len(&e.text) <= 4000 && e.styles.len() <= 64 && e.rect.valid())
            && self.regions.iter().all(Rect::valid)
            && self.strokes.iter().all(|s| !s.points.is_empty() && s.points.iter().all(|p| p.x.is_finite() && p.y.is_finite()))
    }

    /// The words for the message box: the comment first, then where on the
    /// page, in a form an agent can find in the code (selector, tag, a little
    /// of the HTML) without the whole captured context, which ran to pages.
    /// Positions are CSS pixels in the viewport, as in the screenshot. A
    /// picture mark from the page is dropped, as the box would take it for
    /// one of its pictures.
    pub fn draft_text(&self, screenshot: bool) -> String {
        let mut lines: Vec<String> = Vec::new();
        let page = if self.title.is_empty() { self.url.clone() } else { format!("\"{}\" <{}>", one_line(&self.title, 120), self.url) };
        lines.push(format!("Browser annotation on {page}"));
        lines.push(String::new());
        lines.push(if self.comment.is_empty() { "Please look at the marked parts of the page.".to_owned() } else { self.comment.clone() });
        lines.push(String::new());
        let v = &self.viewport;
        lines.push(format!(
            "Marked{}, viewport {}×{} scrolled to {},{}:",
            if screenshot { " (shown in the screenshot)" } else { "" },
            n(v.width),
            n(v.height),
            n(v.scroll_x),
            n(v.scroll_y)
        ));
        for element in &self.elements {
            let words = one_line(&element.text, 80);
            let words = if words.is_empty() { String::new() } else { format!(" \"{words}\"") };
            lines.push(format!("- `{}`{words} at {}", one_line(&element.selector, 300), place(&element.rect)));
            let html = one_line(&element.outer_html, 300);
            if !html.is_empty() {
                lines.push(format!("  `{}`", html.replace('`', "'")));
            }
        }
        for region in &self.regions {
            lines.push(format!("- A region at {}", place(region)));
        }
        if !self.strokes.is_empty() {
            let count = self.strokes.len();
            let noun = if count == 1 { "line" } else { "lines" };
            if screenshot {
                lines.push(format!("- {count} drawn {noun}"));
            } else {
                let around: Vec<String> = self.strokes.iter().map(|s| place(&bounds(s))).collect();
                lines.push(format!("- {count} drawn {noun} (no screenshot), around {}", around.join("; ")));
            }
        }
        lines.join("\n").replace(crate::composer::PICTURE_MARK, "")
    }
}

/// The box's `draft` with an annotation's `words` after it, a blank line
/// between them when there's something already (`BrowserAnnotations.append`).
pub fn after_draft(draft: &str, words: &str) -> String {
    if draft.is_empty() {
        words.to_owned()
    } else {
        format!("{draft}\n\n{words}")
    }
}

fn n(v: f64) -> String {
    format!("{}", v.round() as i64)
}

fn place(r: &Rect) -> String {
    format!("{},{} {}×{}", n(r.x), n(r.y), n(r.width), n(r.height))
}

fn bounds(s: &Stroke) -> Rect {
    let fold = |f: fn(f64, f64) -> f64, pick: fn(&Point) -> f64, start: f64| s.points.iter().map(pick).fold(start, f);
    let (x0, x1) = (fold(f64::min, |p| p.x, f64::INFINITY), fold(f64::max, |p| p.x, f64::NEG_INFINITY));
    let (y0, y1) = (fold(f64::min, |p| p.y, f64::INFINITY), fold(f64::max, |p| p.y, f64::NEG_INFINITY));
    if s.points.is_empty() {
        return Rect { x: 0., y: 0., width: 0., height: 0. };
    }
    Rect { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/// Whitespace runs as one space, cut to `max` characters with an ellipsis.
fn one_line(s: &str, max: usize) -> String {
    let flat = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() > max {
        format!("{}…", flat.chars().take(max).collect::<String>())
    } else {
        flat
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn json() -> String {
        r##"{"url":"http://localhost:5173/cart","title":"Cart","comment":"Make the button bigger","elements":[{"selector":"#save","tagName":"button","outerHTML":"<button id=\"save\">Save\n changes</button>","text":"Save\n  changes","styles":{},"rect":{"x":120.4,"y":340,"width":160,"height":40}}],
         "regions":[{"x":10,"y":20,"width":300,"height":200}],"strokes":[{"points":[{"x":1,"y":2},{"x":11,"y":22}]}],"viewport":{"width":1280,"height":800,"scrollX":0,"scrollY":400}}"##
            .to_owned()
    }

    #[test]
    fn the_draft_says_what_was_marked_and_where() {
        let a = BrowserAnnotation::decode(json().as_bytes()).expect("reads");
        assert_eq!(
            a.draft_text(true),
            "Browser annotation on \"Cart\" <http://localhost:5173/cart>\n\nMake the button bigger\n\nMarked (shown in the screenshot), viewport 1280×800 scrolled to 0,400:\n- `#save` \"Save changes\" at 120,340 160×40\n  `<button id=\"save\">Save changes</button>`\n- A region at 10,20 300×200\n- 1 drawn line"
        );
        assert!(a.draft_text(false).contains("1 drawn line (no screenshot), around 1,2 10×20"));
    }

    #[test]
    fn refuses_anything_oversized_or_empty() {
        let empty = r#"{"url":"x","title":"","comment":"","elements":[],"regions":[],"strokes":[],"viewport":{"width":1,"height":1,"scrollX":0,"scrollY":0}}"#;
        assert_eq!(BrowserAnnotation::decode(empty.as_bytes()), None, "nothing marked");
        assert_eq!(BrowserAnnotation::decode(" ".repeat(600_000).as_bytes()), None, "too big");
        let long = "a".repeat(17_000);
        let wordy = format!(r#"{{"url":"x","title":"","comment":"{long}","elements":[],"regions":[{{"x":0,"y":0,"width":1,"height":1}}],"strokes":[],"viewport":{{"width":1,"height":1,"scrollX":0,"scrollY":0}}}}"#);
        assert_eq!(BrowserAnnotation::decode(wordy.as_bytes()), None, "comment too long");
        let negative = r#"{"url":"x","title":"","comment":"","elements":[],"regions":[{"x":0,"y":0,"width":-1,"height":1}],"strokes":[],"viewport":{"width":1,"height":1,"scrollX":0,"scrollY":0}}"#;
        assert_eq!(BrowserAnnotation::decode(negative.as_bytes()), None, "a region the wrong way out");
        assert_eq!(BrowserAnnotation::decode(b"{\"url\":3}"), None, "malformed");
    }

    #[test]
    fn picture_marks_from_the_page_are_dropped() {
        let data = format!(r#"{{"url":"x","title":"","comment":"see {} here","elements":[],"regions":[{{"x":0,"y":0,"width":1,"height":1}}],"strokes":[],"viewport":{{"width":1,"height":1,"scrollX":0,"scrollY":0}}}}"#, crate::composer::PICTURE_MARK);
        let a = BrowserAnnotation::decode(data.as_bytes()).expect("reads");
        assert!(!a.draft_text(false).contains(crate::composer::PICTURE_MARK));
    }

    #[test]
    fn the_words_go_after_whats_in_the_box() {
        assert_eq!(after_draft("", "Browser annotation"), "Browser annotation");
        assert_eq!(after_draft("Also this", "Browser annotation"), "Also this\n\nBrowser annotation");
    }

    #[test]
    fn browserbears_file_names_its_thread_and_holds_the_annotation() {
        let file = format!(r#"{{"thread":"t1","screenshot":true,"annotation":{}}}"#, json());
        let saved = Saved::read(file.as_bytes()).expect("reads");
        assert_eq!(saved.thread, "t1");
        assert_eq!(saved.screenshot, Some(true));
        assert!(BrowserAnnotation::from_value(&saved.annotation).is_some());
        assert!(Saved::read(" ".repeat(MAX_FILE + 1).as_bytes()).is_none());
        let none = Saved::read(br#"{"thread":"t1"}"#).expect("reads");
        assert!(BrowserAnnotation::from_value(&none.annotation).is_none());
    }
}
