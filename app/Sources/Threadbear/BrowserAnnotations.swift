import AppKit
import Foundation
import ThreadbearCore

/// Annotate, on a page in Tyler's own Chrome (BrowserBear's toolbar popup, or
/// Annotate on a row of the Browser panel): BrowserBear's extension draws the
/// tools, and Attach leaves the annotation in BrowserBear's folder and opens
/// `threadbear://thread/<id>?annotation=<session>`. This puts its words and
/// screenshot in that thread's message box, after anything already there.
/// Nothing is sent: Tyler reads it and presses Send.
/// Adapted from jwsandeman's fork, which did the same for the agents' browser
/// over its debugging port.
@MainActor
enum BrowserAnnotations {
    static var folder: URL {
        URL(fileURLWithPath: AgentBrowser.home).appendingPathComponent("annotations", isDirectory: true)
    }

    private struct Saved: Decodable {
        var thread: String
        var screenshot: Bool?
    }

    private struct Problem: LocalizedError {
        var errorDescription: String?
        init(_ text: String) { errorDescription = text }
    }

    /// Takes the annotation `session` into `threadId`'s message box, once
    /// the thread list is in. Its files go either way.
    static func receive(_ session: String, for threadId: String, app: AppModel) {
        Task {
            for _ in 0..<100 where !app.threadsLoaded { try? await Task.sleep(for: .milliseconds(100)) }
            let json = folder.appendingPathComponent("\(session).json")
            let png = folder.appendingPathComponent("\(session).png")
            defer {
                try? FileManager.default.removeItem(at: json)
                try? FileManager.default.removeItem(at: png)
            }
            do {
                guard let data = FileManager.default.contents(atPath: json.path), data.count <= 600 * 1024 else {
                    throw Problem("That annotation has already been added, or BrowserBear didn't save it.")
                }
                let saved = try JSONDecoder().decode(Saved.self, from: data)
                guard saved.thread == threadId else { throw Problem("That annotation is for another thread.") }
                guard app.threads[threadId] != nil else { throw Problem("The thread for that annotation isn't on this Mac's runner.") }
                let object = (try JSONSerialization.jsonObject(with: data) as? [String: Any])?["annotation"]
                let annotation: BrowserAnnotation
                do {
                    annotation = try BrowserAnnotation.decode(JSONSerialization.data(withJSONObject: object ?? NSNull(), options: [.fragmentsAllowed]))
                } catch { throw Problem("The page sent an annotation Threadbear couldn't read.") }
                var images: [ImageRef] = []
                if saved.screenshot == true, FileManager.default.fileExists(atPath: png.path), NSImage(contentsOf: png) != nil {
                    images = await app.importImages([png])
                }
                append(annotation, images: images, to: threadId, app: app)
                app.focusComposer(threadId)
                AppLog.write("annotation", "added to \(threadId) (\(images.count) picture)")
            } catch {
                app.show(error)
            }
        }
    }

    static func append(_ annotation: BrowserAnnotation, images: [ImageRef], to threadId: String, app: AppModel) {
        var draft = (app.drafts[threadId] ?? Draft()).normalized
        if !draft.text.isEmpty { draft.text += "\n\n" }
        draft.text += annotation.draftText(screenshot: !images.isEmpty)
        draft.append(images)
        app.drafts[threadId] = draft
    }
}
