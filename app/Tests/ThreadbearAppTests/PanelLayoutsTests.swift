import BearDock
@testable import Threadbear
import ThreadbearCore
import XCTest

/// Each project's own panel layout (PanelLayouts): Settings picks the
/// default, View › Panel Layout picks it per project.
@MainActor
final class PanelLayoutsTests: XCTestCase {
    private let keys = [PanelLayouts.modeKey, PanelLayouts.projectLayoutsKey, PanelLayouts.projectModesKey, WindowDock.layoutKey]

    override func setUp() {
        super.setUp()
        keys.forEach { UserDefaults.standard.removeObject(forKey: $0) }
    }

    override func tearDown() {
        keys.forEach { UserDefaults.standard.removeObject(forKey: $0) }
        super.tearDown()
    }

    /// Two projects' threads and one in no project.
    private func app() -> AppModel {
        let app = AppModel()
        app.projects = [Project(id: "site", title: "Website"), Project(id: "run", title: "Runner")]
        app.threads["a"] = ThreadSummary(id: "a", title: "Hero", projects: [ThreadProject(id: "site", title: "Website")])
        app.threads["b"] = ThreadSummary(id: "b", title: "Handover", projects: [ThreadProject(id: "run", title: "Runner")])
        app.threads["c"] = ThreadSummary(id: "c", title: "Groceries")
        app.dock.setLayout(WindowDock.defaultLayout)
        return app
    }

    func testSharedByDefaultKeepsOneLayout() {
        let app = app()
        app.selection = "a"
        app.toggleTerminal()
        app.selection = "b"
        XCTAssertTrue(app.dock.layout.contains(WindowDock.terminal), "one layout for every project")
        XCTAssertNil(app.panelLayouts.current)
    }

    func testEachProjectKeepsItsOwn() {
        let app = app()
        app.setLayoutDefault(.perProject)
        app.selection = "a"
        XCTAssertEqual(app.panelLayouts.current, "site")
        app.toggleTerminal()
        app.selection = "b"
        XCTAssertEqual(app.panelLayouts.current, "run")
        XCTAssertFalse(app.dock.layout.contains(WindowDock.terminal), "Runner starts from the shared layout, which has no Terminal")
        app.selection = "a"
        XCTAssertTrue(app.dock.layout.contains(WindowDock.terminal), "Website's layout came back")
        app.selection = "c"
        XCTAssertNil(app.panelLayouts.current, "a thread in no project uses the shared layout")
        XCTAssertFalse(app.dock.layout.contains(WindowDock.terminal))
    }

    func testAProjectCanUseTheSharedOne() {
        let app = app()
        app.setLayoutDefault(.perProject)
        app.selection = "a"
        app.setLayoutPick(.shared, for: "site")
        XCTAssertNil(app.panelLayouts.current)
        app.toggleTerminal()
        app.selection = "c"
        XCTAssertTrue(app.dock.layout.contains(WindowDock.terminal), "Website's changes went to the shared layout")
        // Its pick stays when the default changes.
        app.setLayoutDefault(.shared)
        app.setLayoutDefault(.perProject)
        XCTAssertEqual(app.panelLayouts.mode(for: "site"), .shared)
    }

    func testAProjectCanHaveItsOwnWhileTheDefaultIsShared() {
        let app = app()
        app.selection = "b"
        app.setLayoutPick(.perProject, for: "run")
        XCTAssertEqual(app.panelLayouts.current, "run")
        app.toggleTerminal()
        app.selection = "a"
        XCTAssertFalse(app.dock.layout.contains(WindowDock.terminal))
    }

    func testANewThreadKeepsTheLayoutShowing() {
        let app = app()
        app.setLayoutDefault(.perProject)
        app.selection = "a"
        app.selection = nil
        XCTAssertEqual(app.panelLayouts.current, "site")
    }

    func testRemembersAcrossLaunches() {
        let first = app()
        first.setLayoutDefault(.perProject)
        first.selection = "a"
        first.toggleTerminal()
        let second = AppModel()
        second.threads = first.threads
        second.projects = first.projects
        XCTAssertFalse(second.dock.layout.contains(WindowDock.terminal), "it opens on the shared layout")
        second.selection = "a"
        XCTAssertTrue(second.dock.layout.contains(WindowDock.terminal))
    }

    func testTheThreadsListKeepsItsWidth() {
        var narrow = WindowDock.defaultLayout
        narrow.setFractions(split: "window", [0.4, 0.4, 0.2])
        let next = WindowDock.carrying(narrow, into: WindowDock.defaultLayout)
        XCTAssertEqual(WindowDock.sidebarShare(in: next) ?? 0, 0.4, accuracy: 0.0001)
        guard case .split(let split) = next.root else { return XCTFail() }
        XCTAssertEqual(split.fractions.reduce(0, +), 1, accuracy: 0.0001)
    }

    func testAThreadInItsOwnPanelStaysOpen() {
        var from = WindowDock.defaultLayout
        from.add(WindowDock.threadPanel("x"), .window(.right))
        XCTAssertTrue(WindowDock.carrying(from, into: WindowDock.defaultLayout).contains(WindowDock.threadPanel("x")))
    }
}
