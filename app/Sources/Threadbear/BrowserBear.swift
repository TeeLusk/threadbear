import Foundation
import ThreadbearCore

/// BrowserBear (github.com/mikecann/browserbear) lets agents use Mike's real
/// Chrome, in a window of its own. When an agent asks him to sign in on a
/// page it has open there and gives the page as a link, opening the link
/// made a second tab of it in his main window while the agent's sat unseen
/// on the other screen (Qantas, 30 Oct 2026). So a web link first asks
/// BrowserBear to hand over an agent tab already on that page: it moves into
/// his window and comes to the front.
enum BrowserBear {
    static var socket: String {
        let home = ProcessInfo.processInfo.environment["BROWSERBEAR_HOME"]
            ?? (NSHomeDirectory() as NSString).appendingPathComponent("Library/Application Support/BrowserBear")
        return (home as NSString).appendingPathComponent("browserbear.sock")
    }

    /// True when an agent's tab was on `url` and is now in front of Mike.
    /// False straight away without BrowserBear, and after 4 s at most when
    /// it doesn't answer: a tab an agent opened is found at once, but ruling
    /// one out means listing Chrome's tabs, which takes seconds while
    /// BrowserBear's extension wakes up (2 s was too short, 30 Oct).
    static func handoff(_ url: URL) async -> Bool {
        guard ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
              FileManager.default.fileExists(atPath: socket) else { return false }
        let path = socket
        return await Task.detached { () -> Bool in
            do { _ = try request(path: path, cmd: "handoff", args: ["tab": url.absoluteString]); return true } catch { return false }
        }.value
    }

    /// Why the @ picker has no tabs to show: said in its one row, never as
    /// an error banner.
    enum Unavailable: Error, Equatable {
        case notRunning
        case noProfile
        case failed(String)
    }

    /// Tyler's open tabs, for the @ picker in `threadId`'s message box:
    /// his own first, with whether that thread may use each one's site.
    /// No `thread` field: that's how the service tells an agent's asks
    /// from his.
    static func tabList(for threadId: String) async -> Result<[BrowserTab], Unavailable> {
        let path = socket
        guard FileManager.default.fileExists(atPath: path) else { return .failure(.notRunning) }
        return await Task.detached { () -> Result<[BrowserTab], Unavailable> in
            do {
                let result = try request(path: path, cmd: "tabList", args: ["for": threadId])
                let data = try JSONSerialization.data(withJSONObject: result ?? [])
                let tabs = try JSONDecoder().decode([BrowserTab].self, from: data)
                // None at all: say so if no Chrome profile is connected.
                if tabs.isEmpty, let status = try? request(path: path, cmd: "status", args: [:]) as? [String: Any],
                   (status["profiles"] as? [Any])?.isEmpty ?? true {
                    return .failure(.noProfile)
                }
                return .success(tabs)
            } catch let error as Unavailable {
                return .failure(error)
            } catch {
                return .failure(.failed(error.localizedDescription))
            }
        }.value
    }

    /// Lends a tab to a thread: BrowserBear claims it for that thread and
    /// lets that thread use that one tab, on its site, until it's released
    /// or closed (the allowed sites don't change), and gives back the words that tell the agent
    /// which tab it is and how to use it.
    static func lend(tab: Int, to threadId: String) async -> Result<String, Unavailable> {
        let path = socket
        return await Task.detached { () -> Result<String, Unavailable> in
            do {
                let result = try request(path: path, cmd: "lendTo", args: ["tab": tab, "to": threadId]) as? [String: Any]
                guard let words = result?["words"] as? String else { return .failure(.failed("BrowserBear didn't say how to use the tab")) }
                return .success(words)
            } catch let error as Unavailable {
                return .failure(error)
            } catch {
                return .failure(.failed(error.localizedDescription))
            }
        }.value
    }

    /// One `{id, cmd, args}` line out, one `{id, ok, result|error}` line
    /// back: the result, or throws.
    private static func request(path: String, cmd: String, args: [String: Any]) throws -> Any? {
        let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw Unavailable.notRunning }
        defer { close(fd) }
        var wait = timeval(tv_sec: 4, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &wait, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &wait, socklen_t(MemoryLayout<timeval>.size))
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8)
        guard bytes.count < MemoryLayout.size(ofValue: addr.sun_path) else { throw Unavailable.notRunning }
        withUnsafeMutableBytes(of: &addr.sun_path) { $0.copyBytes(from: bytes) }
        let connected = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
        }
        guard connected == 0 else { throw Unavailable.notRunning }
        var line = try JSONSerialization.data(withJSONObject: ["id": 1, "cmd": cmd, "args": args] as [String: Any])
        line.append(0x0A)
        guard line.withUnsafeBytes({ write(fd, $0.baseAddress, $0.count) }) == line.count else { throw Unavailable.notRunning }
        var reply = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while !reply.contains(0x0A) {
            let n = read(fd, &buffer, buffer.count)
            if n <= 0 { throw Unavailable.failed("BrowserBear didn't answer") }
            reply.append(contentsOf: buffer[0..<n])
        }
        let object = try JSONSerialization.jsonObject(with: reply.prefix { $0 != 0x0A }) as? [String: Any]
        guard object?["ok"] as? Bool == true else {
            throw Unavailable.failed(object?["error"] as? String ?? "BrowserBear said no")
        }
        return object?["result"]
    }
}
