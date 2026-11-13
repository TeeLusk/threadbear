import BearDock
import Foundation
import SwiftUI
import ThreadbearCore

/// Which panel layout the window shows: the one shared by everything, or a
/// project's own. Settings › General › Panel layout picks the default for
/// every project, and View › Panel Layout picks it for the project in front.
/// A project with its own layout and none saved yet starts from a copy of
/// the shared one. Threads in no project use the shared layout.
///
/// Kept on this Mac (UserDefaults), like the shared layout itself
/// (`WindowDock.layoutKey`).
@MainActor
final class PanelLayouts {
    enum Mode: String, CaseIterable, Identifiable {
        case shared, perProject
        var id: String { rawValue }
        var title: String { self == .shared ? "Shared by all projects" : "Each project has its own" }
    }

    static let modeKey = "panelLayoutMode"
    static let projectLayoutsKey = "projectPanelLayouts"
    static let projectModesKey = "projectPanelLayoutModes"

    let defaults: UserDefaults
    /// The project whose own layout the dock is showing and saving to; nil
    /// for the shared one.
    var current: String?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// The default for every project without a pick of its own.
    var mode: Mode {
        get { defaults.string(forKey: Self.modeKey).flatMap(Mode.init(rawValue:)) ?? .shared }
        set { defaults.set(newValue.rawValue, forKey: Self.modeKey) }
    }

    /// A project's own pick, or nil when it follows `mode`.
    func pick(for project: String) -> Mode? {
        (defaults.dictionary(forKey: Self.projectModesKey)?[project] as? String).flatMap(Mode.init(rawValue:))
    }

    func setPick(_ pick: Mode?, for project: String) {
        var all = defaults.dictionary(forKey: Self.projectModesKey) ?? [:]
        all[project] = pick?.rawValue
        defaults.set(all, forKey: Self.projectModesKey)
    }

    func mode(for project: String) -> Mode { pick(for: project) ?? mode }

    /// Whose layout a project shows: its own id, or nil for the shared one.
    func owner(for project: String?) -> String? {
        guard let project, mode(for: project) == .perProject else { return nil }
        return project
    }

    /// The layout saved for an owner (nil: the shared one), if any.
    func load(_ owner: String?) -> DockLayout? {
        let data = owner.map { defaults.dictionary(forKey: Self.projectLayoutsKey)?[$0] as? Data } ?? defaults.data(forKey: WindowDock.layoutKey)
        return data.flatMap { try? JSONDecoder().decode(DockLayout.self, from: $0) }
    }

    /// Saves the dock's layout as the current owner's.
    func save(_ layout: DockLayout) {
        guard let data = try? JSONEncoder().encode(layout) else { return }
        guard let current else { return defaults.set(data, forKey: WindowDock.layoutKey) }
        var all = defaults.dictionary(forKey: Self.projectLayoutsKey) ?? [:]
        all[current] = data
        defaults.set(all, forKey: Self.projectLayoutsKey)
    }
}

extension WindowDock {
    /// `next`, as a swap from `from` should show it: the threads list keeps
    /// its width, and threads opened in panels of their own and panels in
    /// windows of their own stay open, as they belong to the window rather
    /// than to a project.
    static func carrying(_ from: DockLayout, into next: DockLayout) -> DockLayout {
        var next = repaired(next)
        for float in from.floating where !next.contains(float.panel) {
            next.floating.append(float)
        }
        for panel in from.panels where pinnedThread(panel) != nil && !next.contains(panel) {
            if let main = next.group(containing: WindowDock.main) {
                next.add(panel, .edge(group: main.id, .right))
            } else {
                next.add(panel, .window(.right))
            }
        }
        if let width = sidebarShare(in: from), case .split(var split) = next.root, split.axis == .horizontal,
           let i = split.children.firstIndex(where: { if case .group(let g) = $0 { g.panels.contains(threads) } else { false } }),
           split.fractions.count == split.children.count, split.children.count > 1 {
            let rest = 1 - split.fractions[i]
            let scale = rest > 0 ? (1 - width) / rest : 0
            split.fractions = split.fractions.indices.map { $0 == i ? width : split.fractions[$0] * scale }
            next.root = .split(split)
        }
        return next
    }

    /// The threads list's share of the window's width, when it sits along
    /// the top of the window's own split.
    static func sidebarShare(in layout: DockLayout) -> Double? {
        guard case .split(let split) = layout.root, split.axis == .horizontal, split.fractions.count == split.children.count,
              let i = split.children.firstIndex(where: { if case .group(let g) = $0 { g.panels.contains(threads) } else { false } })
        else { return nil }
        return split.fractions[i]
    }
}

extension AppModel {
    /// The project whose layout fits what the main panel shows: the open
    /// project page's, else the selected thread's first project that's
    /// still around. `.keep` for a new thread and the home pages, which
    /// leave the layout as it is rather than swap it twice on the way
    /// to another thread.
    enum LayoutContext: Equatable { case keep, shared, project(String) }

    var layoutContext: LayoutContext {
        if let project = openProjectId { return .project(project) }
        if showsHomePage { return .keep }
        guard let thread = selectedThread else {
            if let project = newThreadProjectId, projects.contains(where: { $0.id == project }) { return .project(project) }
            return .keep
        }
        let known = Set(projects.map(\.id))
        if let project = thread.projects.first(where: { known.isEmpty || known.contains($0.id) }) { return .project(project.id) }
        return .shared
    }

    /// The project the View › Panel Layout menu picks for, if any.
    var layoutProject: Project? {
        guard case .project(let id) = layoutContext else { return nil }
        return projects.first { $0.id == id }
    }

    /// Swaps the dock to the layout the context's project uses, sliding the
    /// panels across (DockController.setLayout animates it).
    func followLayoutContext() {
        let owner: String?
        switch layoutContext {
        case .keep: return
        case .shared: owner = nil
        case .project(let id): owner = panelLayouts.owner(for: id)
        }
        guard owner != panelLayouts.current else { return }
        let from = dock.layout
        // A project's first own layout is a copy of the shared one.
        let saved = panelLayouts.load(owner) ?? panelLayouts.load(nil)
        panelLayouts.current = owner
        dock.setLayout(WindowDock.carrying(from, into: saved ?? WindowDock.defaultLayout))
    }

    /// View › Panel Layout: the project in front uses the shared layout or
    /// its own from now on.
    func setLayoutPick(_ mode: PanelLayouts.Mode, for project: String) {
        panelLayouts.setPick(mode, for: project)
        layoutModeVersion &+= 1
        followLayoutContext()
    }

    /// Settings, or the menu's Make Default: the default for every project
    /// without a pick of its own. A project's own pick stays.
    func setLayoutDefault(_ mode: PanelLayouts.Mode) {
        panelLayouts.mode = mode
        layoutModeVersion &+= 1
        followLayoutContext()
    }
}

/// View › Panel Layout: whether the project in front uses the shared layout
/// or its own, with the default for every project starred and set from the
/// same menu (AGENTS.md: a menu that picks one thing with a default). Its
/// state is worked out by the menu bar's body and handed in, as a submenu's
/// own body isn't redrawn when the selection moves.
struct PanelLayoutMenu: View {
    let app: AppModel
    let project: Project?
    let mode: PanelLayouts.Mode
    let fallback: PanelLayouts.Mode

    init(app: AppModel) {
        _ = app.layoutModeVersion
        self.app = app
        project = app.layoutProject
        mode = project.map { app.panelLayouts.mode(for: $0.id) } ?? .shared
        fallback = app.panelLayouts.mode
    }

    var body: some View {
        IconMenu("Panel Layout", systemImage: "rectangle.split.3x1") {
            Button(Self.title("Shared Layout", isDefault: fallback == .shared), systemImage: mode == .shared ? "checkmark" : "rectangle.on.rectangle") {
                if let project { app.setLayoutPick(.shared, for: project.id) }
            }
            .disabled(project == nil)
            Button(Self.title(project.map { "Own Layout for \($0.title)" } ?? "Own Layout for This Project", isDefault: fallback == .perProject),
                   systemImage: mode == .perProject ? "checkmark" : "folder") {
                if let project { app.setLayoutPick(.perProject, for: project.id) }
            }
            .disabled(project == nil)
            Divider()
            Button(mode == .shared ? "Make Shared the Default" : "Make Own Layout the Default", systemImage: "star") {
                app.setLayoutDefault(mode)
            }
            .disabled(project == nil || mode == fallback)
        }
    }

    static func title(_ title: String, isDefault: Bool) -> String { isDefault ? "\(title) ★" : title }
}
