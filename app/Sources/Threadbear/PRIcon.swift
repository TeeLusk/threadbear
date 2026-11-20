import AppKit
import ThreadbearCore

/// Pull request and check icons for the sidebar badge and the side pane's
/// pull requests. They're Hugeicons' stroke-rounded icons from the free set
/// (`@hugeicons/core-free-icons` 4.4.0, MIT, hugeicons.com), kept here as
/// SVG elements like `ProviderLogo` keeps its marks: no package and no
/// resource files. As templates they take the colour they're given.
enum PRIcon: String, CaseIterable {
    case pullRequest, draft, closed, merged, passed, failed, running

    @MainActor private static var cache: [String: NSImage] = [:]

    /// The icon as a square template image `side` points across. Hugeicons
    /// draw at 1.5 on a 24 grid, which is under a point at sidebar sizes, so
    /// small ones get a heavier stroke to read as clearly as the text.
    @MainActor
    static func image(_ icon: PRIcon, side: CGFloat) -> NSImage {
        let key = "\(icon.rawValue)@\(side)"
        if let cached = cache[key] { return cached }
        let width = side < 18 ? 2 : 1.5
        let svg = #"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="black" stroke-width=""#
            + "\(width)" + #"" stroke-linecap="round" stroke-linejoin="round">"# + icon.elements + "</svg>"
        let image = NSImage(data: Data(svg.utf8)) ?? NSImage()
        image.size = NSSize(width: side, height: side)
        image.isTemplate = true
        image.accessibilityDescription = icon.label
        cache[key] = image
        return image
    }

    /// The shape for a pull request in this state.
    static func forState(_ state: PRState) -> PRIcon {
        switch state {
        case .merged: return .merged
        case .closed: return .closed
        case .draft: return .draft
        case .open, .unknown: return .pullRequest
        }
    }

    /// The shape for the sidebar's tone: the worst PR's.
    static func forTone(_ tone: PRTone) -> PRIcon {
        switch tone {
        case .merged: return .merged
        case .closed: return .closed
        case .draft: return .draft
        case .failing, .running, .open: return .pullRequest
        }
    }

    /// The shape for one check's outcome; nil for skipped or unknown.
    static func forOutcome(_ outcome: PROutcome) -> PRIcon? {
        switch outcome {
        case .passed: return .passed
        case .failed: return .failed
        case .running: return .running
        case .skipped, .unknown: return nil
        }
    }

    private var label: String {
        switch self {
        case .pullRequest: return "Pull request"
        case .draft: return "Draft pull request"
        case .closed: return "Closed pull request"
        case .merged: return "Merged pull request"
        case .passed: return "Passed"
        case .failed: return "Failed"
        case .running: return "Running"
        }
    }

    private var elements: String {
        switch self {
        case .pullRequest: // GitPullRequestIcon
            return #"<path d="M6 8L6 16"/><path d="M18 16V12C18 9.17156 18 7.75735 17.1213 6.87867C16.2426 5.99999 14.8284 5.99999 12 5.99999L11 5.99999M11 5.99999C11 5.29976 12.9943 3.99152 13.5 3.49999M11 5.99999C11 6.70022 12.9943 8.00846 13.5 8.49999"/><circle cx="6" cy="18" r="2"/><circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/>"#
        case .draft: // GitPullRequestDraftIcon
            return #"<path d="M6 8L6 16"/><circle cx="6" cy="18" r="2"/><circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M18.125 11H18M18.25 11C18.25 11.1381 18.1381 11.25 18 11.25C17.8619 11.25 17.75 11.1381 17.75 11C17.75 10.8619 17.8619 10.75 18 10.75C18.1381 10.75 18.25 10.8619 18.25 11Z"/><path d="M18.125 6H18M18.25 6C18.25 6.13807 18.1381 6.25 18 6.25C17.8619 6.25 17.75 6.13807 17.75 6C17.75 5.86193 17.8619 5.75 18 5.75C18.1381 5.75 18.25 5.86193 18.25 6Z"/>"#
        case .closed: // GitPullRequestClosedIcon
            return #"<path d="M6 8L6 16"/><path d="M18 11L18 16"/><circle cx="6" cy="18" r="2"/><circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M20 4L18 6M18 6L16 8M18 6L20 8M18 6L16 4"/>"#
        case .merged: // GitMergeIcon
            return #"<path d="M7 20C8.10457 20 9 19.1046 9 18C9 16.8954 8.10457 16 7 16C5.89543 16 5 16.8954 5 18C5 19.1046 5.89543 20 7 20Z"/><path d="M7 8C8.10457 8 9 7.10457 9 6C9 4.89543 8.10457 4 7 4C5.89543 4 5 4.89543 5 6C5 7.10457 5.89543 8 7 8Z"/><path d="M17 14C18.1046 14 19 13.1046 19 12C19 10.8954 18.1046 10 17 10C15.8954 10 15 10.8954 15 12C15 13.1046 15.8954 14 17 14Z"/><path d="M7.02116 8.2793V15.4073M14.4113 12.0047L10.0193 12.0048C8.92158 12.0048 6.86182 11.1254 7.01818 8.78001"/>"#
        case .passed: // CheckmarkCircle02Icon
            return #"<path d="M22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12Z"/><path d="M8 12.5L10.5 15L16 9"/>"#
        case .failed: // CancelCircleIcon
            return #"<path d="M22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12Z"/><path d="M14.9994 15L12 12.0003M12 12.0003L9 9M12 12.0003L9.00064 15M12 12.0003L15 9"/>"#
        case .running: // Loading03Icon
            return #"<path d="M12 3V6"/><path d="M12 18V21"/><path d="M21 12L18 12"/><path d="M6 12L3 12"/><path d="M18.3635 5.63672L16.2422 7.75804"/><path d="M7.75804 16.2422L5.63672 18.3635"/><path d="M18.3635 18.3635L16.2422 16.2422"/><path d="M7.75804 7.75804L5.63672 5.63672"/>"#
        }
    }
}
