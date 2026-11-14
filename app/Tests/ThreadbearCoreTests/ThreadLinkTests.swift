import Foundation
import XCTest
@testable import ThreadbearCore

final class ThreadLinkTests: XCTestCase {
    func testReadsTheThreadIdBack() {
        let url = ThreadLink.url(threadId: "6309da76-d0c5-49a1-bddf-9820bf6124dc")!
        XCTAssertEqual(url.absoluteString, "threadbear://thread/6309da76-d0c5-49a1-bddf-9820bf6124dc")
        XCTAssertEqual(ThreadLink.threadId(from: url), "6309da76-d0c5-49a1-bddf-9820bf6124dc")
    }

    func testIgnoresOtherLinks() {
        for link in ["threadbear://pair?url=x&token=y", "threadbear://thread/", "threadbear://thread/../etc", "https://thread/abc", "threadbear://thread/a%20b"] {
            XCTAssertNil(ThreadLink.threadId(from: URL(string: link)!), link)
        }
    }

    func testReadsAnAnnotationFromBrowserBear() {
        let session = "0f8e2c1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b"
        let url = URL(string: "threadbear://thread/6309da76-d0c5-49a1-bddf-9820bf6124dc?annotation=\(session)")!
        XCTAssertEqual(ThreadLink.threadId(from: url), "6309da76-d0c5-49a1-bddf-9820bf6124dc")
        XCTAssertEqual(ThreadLink.annotationId(from: url), session)
        for link in ["threadbear://thread/abc", "threadbear://thread/abc?annotation=../../x", "threadbear://thread/abc?annotation=0F8E2C1A-3B4D-4E5F-8A9B-0C1D2E3F4A5B",
                     "threadbear://pair?annotation=\(session)"] {
            XCTAssertNil(ThreadLink.annotationId(from: URL(string: link)!), link)
        }
    }
}
