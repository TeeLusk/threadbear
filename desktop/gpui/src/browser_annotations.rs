// Annotate, on a page in Tyler's own Chrome (BrowserBear's toolbar popup, or
// Annotate on a row of the Browser panel, agent_browser.rs): BrowserBear's
// extension draws the tools, and Attach leaves the annotation in BrowserBear's
// folder and opens `threadbear://thread/<id>?annotation=<session>`
// (deep_links.rs). This puts its words and screenshot in that thread's message
// box, after anything already there. Nothing is sent: Tyler reads it and
// presses Send. A port of the Swift app's BrowserAnnotations.swift; the words
// are threadbear_core::browser_annotation's.
use crate::app::Threadbear;
use gpui_kit::*;
use std::path::PathBuf;
use std::time::Duration;
use threadbear_core::browser_annotation::{BrowserAnnotation, Saved};

/// BrowserBear's `annotations` folder, none for a scripted app without
/// `BROWSERBEAR_HOME` (agent_browser.rs).
fn folder() -> Option<PathBuf> {
    crate::agent_browser::home().map(|h| h.join("annotations"))
}

/// What a link's annotation came to: the words and the picture to add, or
/// why not. Its files go either way.
fn take(session: &str, thread: &str, folder: &std::path::Path, here: impl Fn(&str) -> Result<(), String>) -> Result<(String, Option<PathBuf>), String> {
    let json = folder.join(format!("{session}.json"));
    let png = folder.join(format!("{session}.png"));
    let result = (|| -> Result<(String, Option<PathBuf>), String> {
        let data = threadbear_core::open_policy::local_open(&json)
            .ok()
            .and_then(|f| {
                use std::io::Read as _;
                let mut data = Vec::new();
                f.take(threadbear_core::browser_annotation::MAX_FILE as u64 + 1).read_to_end(&mut data).ok().map(|_| data)
            })
            .and_then(|d| Saved::read(&d))
            .ok_or_else(|| "That annotation has already been added, or BrowserBear didn't save it.".to_owned())?;
        if data.thread != thread {
            return Err("That annotation is for another thread.".to_owned());
        }
        here(thread)?;
        let annotation = BrowserAnnotation::from_value(&data.annotation).ok_or_else(|| "The page sent an annotation Threadbear couldn't read.".to_owned())?;
        // A copy of the screenshot, kept for the box's chip to copy in
        // through the runner, as BrowserBear's is deleted now.
        let picture = (data.screenshot == Some(true)).then(|| crate::composer::capture_picture(&png)).flatten();
        Ok((annotation.draft_text(picture.is_some()), picture))
    })();
    let _ = std::fs::remove_file(&json);
    let _ = std::fs::remove_file(&png);
    result
}

/// How long the annotation waits for the thread list before saying its
/// thread isn't on this Mac.
const WAIT: Duration = Duration::from_secs(10);

impl Threadbear {
    /// Takes the annotation `session` into `thread`'s message box once the
    /// thread list is in, and puts the cursor there.
    pub(crate) fn receive_annotation(&mut self, session: String, thread: String, cx: &mut Context<Self>) {
        let Some(folder) = folder() else { return };
        cx.spawn(async move |this, cx| {
            let started = std::time::Instant::now();
            while this.update(cx, |this, _| !this.sidebar.loaded).unwrap_or(false) && started.elapsed() < WAIT {
                cx.background_executor().timer(Duration::from_millis(100)).await;
            }
            this.update(cx, |this, cx| this.add_annotation(&session, &thread, &folder, cx)).ok();
        })
        .detach();
    }

    fn add_annotation(&mut self, session: &str, thread: &str, folder: &std::path::Path, cx: &mut Context<Self>) {
        let here = |id: &str| match self.threads.get(id) {
            Some(t) if !t.is_remote() => Ok(()),
            _ => Err("The thread for that annotation isn't on this Mac's runner.".to_owned()),
        };
        match take(session, thread, folder, here) {
            Ok((words, picture)) => {
                let pictures = usize::from(picture.is_some());
                let (me, window) = (cx.entity().downgrade(), self.main_window);
                threadbear_client::log::write("annotation", &format!("added to {thread} ({pictures} picture)"));
                let thread = thread.to_owned();
                // The box needs the window, whose update comes back here.
                cx.defer(move |cx| {
                    window
                        .update(cx, |_, window, cx| {
                            me.update(cx, |this, cx| {
                                let composer = this.composer_for(&thread, window, cx);
                                composer.update(cx, |c, cx| c.add_annotation(words, picture, cx));
                                this.drafts_changed(cx);
                            })
                            .ok();
                        })
                        .ok();
                });
            }
            Err(why) => self.show_error(why, cx),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::take;

    const SESSION: &str = "0f8e2c1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
    const ANNOTATION: &str = r#"{"url":"http://localhost:5173/","title":"Home","comment":"Bigger","elements":[],"regions":[{"x":1,"y":2,"width":3,"height":4}],"strokes":[],"viewport":{"width":800,"height":600,"scrollX":0,"scrollY":0}}"#;

    fn folder_with(thread: &str) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(format!("{SESSION}.json")), format!(r#"{{"thread":"{thread}","screenshot":false,"annotation":{ANNOTATION}}}"#)).unwrap();
        dir
    }

    #[test]
    fn the_words_come_out_and_the_files_go() {
        let dir = folder_with("t1");
        let (words, picture) = take(SESSION, "t1", dir.path(), |_| Ok(())).unwrap();
        assert!(words.starts_with("Browser annotation on \"Home\" <http://localhost:5173/>\n\nBigger"));
        assert_eq!(picture, None);
        assert!(!dir.path().join(format!("{SESSION}.json")).exists());
        assert_eq!(take(SESSION, "t1", dir.path(), |_| Ok(())).unwrap_err(), "That annotation has already been added, or BrowserBear didn't save it.");
    }

    #[test]
    fn another_threads_annotation_or_one_not_here_says_so() {
        let dir = folder_with("t2");
        assert_eq!(take(SESSION, "t1", dir.path(), |_| Ok(())).unwrap_err(), "That annotation is for another thread.");
        assert!(!dir.path().join(format!("{SESSION}.json")).exists(), "gone either way");
        let dir = folder_with("t1");
        assert_eq!(take(SESSION, "t1", dir.path(), |_| Err("not here".into())).unwrap_err(), "not here");
    }
}
