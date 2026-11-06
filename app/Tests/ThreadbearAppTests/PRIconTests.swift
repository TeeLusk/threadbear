import XCTest
@testable import Threadbear
import ThreadbearCore

@MainActor
final class PRIconTests: XCTestCase {
    func testSkippedCheckHasItsOwnIcon() {
        XCTAssertEqual(PRIcon.forOutcome(.skipped), .skipped)
        XCTAssertEqual(PRIcon.image(.skipped, side: 16).accessibilityDescription, "Skipped")
        XCTAssertNil(PRIcon.forOutcome(.unknown))
    }
}
