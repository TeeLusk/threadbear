import Foundation
import XCTest
@testable import ThreadbearCore

final class BrowserAnnotationTests: XCTestCase {
    private func json(_ extra: String = "") -> Data {
        Data("""
        {"url":"http://localhost:5173/cart","title":"Cart","comment":"Make the button bigger","elements":[{"selector":"#save","tagName":"button","outerHTML":"<button id=\\"save\\">Save\\n changes</button>","text":"Save\\n  changes","styles":{},"rect":{"x":120.4,"y":340,"width":160,"height":40}}],
         "regions":[{"x":10,"y":20,"width":300,"height":200}],"strokes":[{"points":[{"x":1,"y":2},{"x":11,"y":22}]}],"viewport":{"width":1280,"height":800,"scrollX":0,"scrollY":400}\(extra)}
        """.utf8)
    }

    func testTheDraftSaysWhatWasMarkedAndWhere() throws {
        let text = try BrowserAnnotation.decode(json()).draftText(screenshot: true)
        XCTAssertEqual(text, """
        Browser annotation on "Cart" <http://localhost:5173/cart>

        Make the button bigger

        Marked (shown in the screenshot), viewport 1280×800 scrolled to 0,400:
        - `#save` "Save changes" at 120,340 160×40
          `<button id="save">Save changes</button>`
        - A region at 10,20 300×200
        - 1 drawn line
        """)
        XCTAssertTrue(try BrowserAnnotation.decode(json()).draftText(screenshot: false).contains("1 drawn line (no screenshot), around 1,2 10×20"))
    }

    func testRefusesAnythingOversizedOrEmpty() {
        XCTAssertThrowsError(try BrowserAnnotation.decode(Data("""
        {"url":"x","title":"","comment":"","elements":[],"regions":[],"strokes":[],"viewport":{"width":1,"height":1,"scrollX":0,"scrollY":0}}
        """.utf8)))
        XCTAssertThrowsError(try BrowserAnnotation.decode(Data(String(repeating: " ", count: 600_000).utf8)))
        let long = String(repeating: "a", count: 17_000)
        XCTAssertThrowsError(try BrowserAnnotation.decode(Data("""
        {"url":"x","title":"","comment":"\(long)","elements":[],"regions":[{"x":0,"y":0,"width":1,"height":1}],"strokes":[],"viewport":{"width":1,"height":1,"scrollX":0,"scrollY":0}}
        """.utf8)))
    }

    func testPictureMarksFromThePageAreDropped() throws {
        let mark = InlinePictures.markString
        let data = Data("""
        {"url":"x","title":"","comment":"see \(mark) here","elements":[],"regions":[{"x":0,"y":0,"width":1,"height":1}],"strokes":[],"viewport":{"width":1,"height":1,"scrollX":0,"scrollY":0}}
        """.utf8)
        XCTAssertFalse(try BrowserAnnotation.decode(data).draftText(screenshot: false).contains(mark))
    }
}
