import AppKit
import SwiftUI
import ThreadbearCore

/// What the composer keeps for its @ picker: the tab picked with the
/// arrows, and the text Esc closed it at (closed until the text changes).
struct TabPaletteState: Equatable {
    var selected: Int?
    var closedAt: String?
}

/// The @ picker over the message box, in the slash palette's panel
/// (SlashPalettePanel): Tyler's open Chrome tabs from BrowserBear, those
/// whose title or host has what's typed after the @. Arrows move, Return
/// or Tab or a click picks one, Esc closes it. Picking one lends it to the
/// thread (ComposerView.pickTab).
struct TabPaletteView: View {
    /// Nil while BrowserBear is being asked.
    let tabs: Result<[BrowserTab], BrowserBear.Unavailable>?
    let query: String
    let threadId: String
    @Binding var state: TabPaletteState
    var onPick: (BrowserTab) -> Void
    @Binding var layout: SlashPalette.Layout

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background {
                RoundedRectangle(cornerRadius: zoomed(14), style: .continuous)
                    .fill(Color(nsColor: .windowBackgroundColor))
            }
            .overlay(RoundedRectangle(cornerRadius: zoomed(14), style: .continuous).strokeBorder(Color(nsColor: .separatorColor), lineWidth: 0.5))
            .clipShape(RoundedRectangle(cornerRadius: zoomed(14), style: .continuous))
            .iconContextMenu {
                Button("Default Size", systemImage: "arrow.down.right.and.arrow.up.left") {
                    layout.width = nil
                    layout.height = nil
                }
            }
    }

    @ViewBuilder
    private var content: some View {
        switch tabs {
        case nil:
            placeholder("Getting your Chrome tabs…")
        case .failure(let why):
            placeholder(Self.unavailableText(why))
        case .success(let all):
            let matches = TabMention.matches(all, query: query)
            let picked = Self.picked(matches, state: state)
            if matches.isEmpty {
                placeholder(query.isEmpty ? "No open tabs in Chrome." : "No tab matches @\(query).")
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            ForEach(matches) { tab in
                                row(tab, on: tab.tabId == picked?.tabId).id(tab.tabId)
                            }
                        }
                    }
                    .onChange(of: picked?.tabId) { _, id in
                        if let id { proxy.scrollTo(id) }
                    }
                    .padding(.vertical, zoomed(6))
                }
            }
        }
    }

    private func row(_ tab: BrowserTab, on: Bool) -> some View {
        HStack(alignment: .center, spacing: zoomed(10)) {
            favicon(tab)
            VStack(alignment: .leading, spacing: zoomed(2)) {
                Text(tab.title.isEmpty ? tab.host : tab.title)
                    .font(.system(size: TypeScale.label + 1, weight: .medium))
                    .lineLimit(1)
                    .truncationMode(.tail)
                Text([tab.host, tab.profile].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.system(size: TypeScale.label - 1))
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .opacity(0.7)
            }
            Spacer(minLength: zoomed(6))
            if let hint = Self.hint(tab, threadId: threadId) {
                // Whole: cut short it read "this tab…", the part that matters.
                Text(hint)
                    .font(.system(size: TypeScale.label - 1))
                    .lineLimit(1)
                    .fixedSize()
                    .opacity(0.75)
            }
        }
        .foregroundStyle(on ? Color.white : .primary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, zoomed(14))
        .padding(.vertical, zoomed(6))
        .background(on ? Color(nsColor: .controlAccentColor).opacity(0.75) : .clear)
        .contentShape(Rectangle())
        .onTapGesture { onPick(tab) }
        .tip(Self.tip(tab, threadId: threadId))
    }

    /// The page's favicon, as Chrome shows it in the tab; a globe while
    /// it loads, or when the site has none.
    private func favicon(_ tab: BrowserTab) -> some View {
        let size = zoomed(16)
        return AsyncImage(url: tab.iconURL) { phase in
            if let image = phase.image {
                image.resizable().interpolation(.high).scaledToFit()
            } else {
                Image(systemName: "globe").resizable().scaledToFit().opacity(0.5)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: zoomed(3)))
    }

    private func placeholder(_ text: String) -> some View {
        Text(text)
            .font(.system(size: TypeScale.label + 1))
            .foregroundStyle(.secondary)
            .padding(zoomed(16))
            .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}

extension TabPaletteView {
    static func unavailableText(_ why: BrowserBear.Unavailable) -> String {
        switch why {
        case .notRunning: "BrowserBear isn't running, so there are no Chrome tabs to pick."
        case .noProfile: "No Chrome profile is connected to BrowserBear."
        case .failed(let message): "BrowserBear couldn't list your tabs: \(message)"
        }
    }

    /// The small note at a row's end.
    static func hint(_ tab: BrowserTab, threadId: String) -> String? {
        if tab.lentTo == threadId { return "Lent here" }
        if tab.lentTo != nil { return "Lent to another thread" }
        if tab.allowed == false { return "Picking gives this chat this tab only" }
        return nil
    }

    static func tip(_ tab: BrowserTab, threadId: String) -> String {
        var tip = "Lend this tab to the thread and mention it in your message"
        if tab.allowed == false { tip += ". \(tab.host) isn't on the allowed sites: picking it lets this chat use this one tab, not the site, until the tab is released or closed" }
        if tab.lentTo != nil, tab.lentTo != threadId { tip += ". It moves from the thread it's lent to now" }
        return tip
    }

    static func picked(_ matches: [BrowserTab], state: TabPaletteState) -> BrowserTab? {
        matches.first { $0.tabId == state.selected } ?? matches.first
    }

    /// What a key does with these matches: moves the pick, or gives the
    /// tab to pick (Tab, Return). Nil: nothing picked.
    static func handle(_ key: PaletteKey, matches: [BrowserTab], state: inout TabPaletteState, text: String) -> BrowserTab? {
        let index = matches.firstIndex { $0.tabId == state.selected } ?? 0
        switch key {
        case .up:
            if !matches.isEmpty { state.selected = matches[max(0, index - 1)].tabId }
        case .down:
            if !matches.isEmpty { state.selected = matches[min(matches.count - 1, index + 1)].tabId }
        case .escape:
            state.closedAt = text
        case .tab, .enter:
            return matches.indices.contains(index) ? matches[index] : nil
        }
        return nil
    }

    /// Room for the rows there are, between the panel's least and about
    /// half the window.
    static func height(rows: Int, window: CGFloat) -> CGFloat {
        let wanted = CGFloat(max(rows, 2)) * zoomed(44) + zoomed(12)
        return min(max(wanted, 220), max(220, window * 0.5))
    }
}

extension AppModel {
    /// Asks BrowserBear for the tabs each time the picker opens, so a tab
    /// opened meanwhile is there.
    func loadBrowserTabs(_ threadId: String) {
        guard browserTabFetches[threadId] == nil else { return }
        browserTabFetches[threadId] = Task { [weak self] in
            defer { self?.browserTabFetches[threadId] = nil }
            let result = await BrowserBear.tabList(for: threadId)
            self?.browserTabs[threadId] = result
        }
    }

    /// Lends a picked tab to the thread at once, so the claim is in place
    /// by the agent's first command. Until BrowserBear answers, the
    /// message would carry words made here; a lend that fails says so.
    func lendTab(_ tab: BrowserTab, to threadId: String) {
        lentTabs[threadId, default: [:]][tab.tabId] = TabMention.fallbackWords(tab)
        Task { [weak self] in
            switch await BrowserBear.lend(tab: tab.tabId, to: threadId) {
            case .success(let words):
                self?.lentTabs[threadId, default: [:]][tab.tabId] = words
            case .failure(let why):
                self?.lentTabs[threadId]?[tab.tabId] = nil
                let reason: String = switch why {
                case .notRunning: "BrowserBear isn't running"
                case .noProfile: "no Chrome profile is connected to BrowserBear"
                case .failed(let message): message
                }
                self?.showError("Couldn't lend \"\(tab.title)\" to this thread: \(reason).", in: threadId, doing: "lending a Chrome tab with @")
            }
        }
    }
}
