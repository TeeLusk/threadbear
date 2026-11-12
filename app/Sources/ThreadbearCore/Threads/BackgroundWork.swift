import Foundation

/// Words for a thread's background work (`ThreadSummary.background`): the
/// short form at the right of a sidebar row, the line at the end of the
/// transcript, and the descriptions for a tooltip. Plain counts, since the
/// CLI's descriptions can be anything from "npm test" to a paragraph.
public enum BackgroundWork {
    /// Short, for the sidebar: "3 sub-agents", "1 job", "4 jobs" (mixed),
    /// "Finishing" when all that's left is a result about to be read.
    public static func short(_ tasks: [BackgroundTask]) -> String {
        let running = tasks.filter { !$0.finished }
        guard !running.isEmpty else { return "Finishing" }
        // All of it waiting its turn: not running yet.
        if running.allSatisfy({ $0.queuedBehind != nil }) { return "Queued" }
        let kinds = Set(running.map(\.kind))
        if kinds.count == 1, let kind = kinds.first { return count(running.count, kind) }
        return count(running.count, .shell)
    }

    /// One line, for the transcript: "3 sub-agents working in the
    /// background", "1 job running in the background, 1 just finished",
    /// "2 sub-agents just finished, about to read their results".
    public static func line(_ tasks: [BackgroundTask]) -> String {
        let running = tasks.filter { !$0.finished }
        let finished = tasks.count - running.count
        if running.isEmpty {
            let finishedTasks = tasks.filter(\.finished)
            let kinds = Set(finishedTasks.map(\.kind))
            let what = kinds.count == 1 ? count(finished, kinds.first!) : count(finished, .shell)
            return "\(what) just finished, about to read \(finished == 1 ? "its result" : "their results")"
        }
        // Jobs waiting their turn on a lock say so (protocol "Queued jobs"),
        // first, as that's why nothing seems to happen.
        let queued = running.filter { $0.queuedBehind != nil }
        let going = running.filter { $0.queuedBehind == nil }
        var lines: [String] = []
        if !queued.isEmpty {
            let behind = Set(queued.compactMap { $0.queuedBehind.flatMap { $0.isEmpty ? nil : $0 } })
            lines.append("\(count(queued.count, .shell)) queued" + (behind.count == 1 ? " behind \(behind.first!)" : ""))
        }
        if !going.isEmpty {
            let order: [BackgroundTask.Kind] = [.agent, .shell, .monitor, .other]
            let parts = order.compactMap { kind -> String? in
                let n = going.filter { $0.kind == kind }.count
                return n == 0 ? nil : count(n, kind)
            }
            let verb = parts.count == 1 && going[0].kind == .agent ? "working" : "running"
            lines.append(queued.isEmpty ? "\(join(parts)) \(verb) in the background" : "\(join(parts)) \(verb)")
        }
        var text = lines.joined(separator: ", ")
        if finished > 0 { text += ", \(finished) just finished" }
        return text
    }

    /// The descriptions, one per line, for a tooltip. Empty descriptions
    /// fall back to the kind's word.
    public static func detail(_ tasks: [BackgroundTask]) -> String {
        tasks.map { task in
            let name = task.description.isEmpty ? count(1, task.kind) : task.description
            if task.finished { return "\(name) (finished)" }
            if let behind = task.queuedBehind { return behind.isEmpty ? "\(name) (queued)" : "\(name) (queued behind \(behind))" }
            return name
        }.joined(separator: "\n")
    }

    /// The descriptions in one line after the summary, for the transcript:
    /// "3 sub-agents working in the background · Rebuild page A, Rebuild
    /// page B". Descriptions are the CLI's, so a long one is cut.
    public static func lineWithDetail(_ tasks: [BackgroundTask]) -> String {
        let names = tasks.compactMap { task -> String? in
            guard !task.description.isEmpty else { return nil }
            let oneLine = task.description.split(whereSeparator: \.isNewline).first.map(String.init) ?? task.description
            let cut = oneLine.count > 60 ? String(oneLine.prefix(59)) + "…" : oneLine
            return task.finished ? "\(cut) (finished)" : cut
        }
        return names.isEmpty ? line(tasks) : "\(line(tasks)) · \(names.joined(separator: ", "))"
    }

    /// The background list with its shell jobs marked queued, one per job
    /// that said it's waiting (protocol "Queued jobs"). The CLI doesn't say
    /// which job is which, so it's the newest still running, as a job
    /// queues as it starts; a queued job run in the foreground marks none.
    public static func marking(_ tasks: [BackgroundTask], queued: [QueuedJob]) -> [BackgroundTask] {
        guard !queued.isEmpty else { return tasks }
        var out = tasks
        var left = queued
        for i in out.indices.reversed() where !left.isEmpty && out[i].kind == .shell && !out[i].finished {
            out[i].queuedBehind = left.removeLast().behind ?? ""
        }
        return out
    }

    private static func count(_ n: Int, _ kind: BackgroundTask.Kind) -> String {
        switch kind {
        case .agent: return n == 1 ? "1 sub-agent" : "\(n) sub-agents"
        case .shell: return n == 1 ? "1 job" : "\(n) jobs"
        case .monitor: return n == 1 ? "1 monitor" : "\(n) monitors"
        case .other: return n == 1 ? "1 task" : "\(n) tasks"
        }
    }

    private static func join(_ parts: [String]) -> String {
        switch parts.count {
        case 0: return ""
        case 1: return parts[0]
        case 2: return "\(parts[0]) and \(parts[1])"
        default: return parts.dropLast().joined(separator: ", ") + " and " + parts[parts.count - 1]
        }
    }
}
