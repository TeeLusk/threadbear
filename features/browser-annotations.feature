Feature: Annotating a page in Chrome for a thread
  As someone whose agents build the pages I look at in my own Chrome
  I want to mark what to change on a page and have it land in the thread's message box
  So I can show the agent what I mean, with a screenshot, before I send it

  Background:
    Given the app is connected to a runner with the demo threads

  # BrowserBear is a Mac tool talking over a Unix socket (browser-pane.feature
  # says why these don't run on Windows). The Swift app's dump has no Browser
  # pane, and it's frozen, so these are checked on the GPUI app only.

  @browserbear @windows-pending @browser.annotate @swift-pending
  Scenario: Annotate on a page in my own Chrome asks BrowserBear for its tools
    Given my Chrome has "Cart" at "http://localhost:5173/cart" open for "Morning brief"
    When I open the thread "Morning brief"
    And I click the right rail's Browser button
    Then the Browser pane lists "Cart" from "localhost" with "Show window, Annotate"
    When I press "Annotate" on "Cart"
    Then BrowserBear was asked to annotate "Cart" for "Morning brief"

  @browserbear @windows-pending @browser.annotate @nav.deeplink @swift-pending
  Scenario: An annotation goes after what's in the box, with its screenshot, unsent
    Given I open the thread "Morning brief"
    And I type "Also check the footer" in the composer, replacing what's there
    When BrowserBear attaches an annotation saying "Make the button bigger" for "Morning brief"
    Then the composer has "Also check the footer" then the annotation saying "Make the button bigger"
    And the composer has 1 picture
    And BrowserBear's annotation files are gone

  @browserbear @windows-pending @browser.annotate @nav.deeplink @swift-pending
  Scenario: An annotation for another thread is refused and its files still go
    Given I open the thread "Morning brief"
    When BrowserBear attaches an annotation for "Morning brief" through a link to "Rename the Settings tabs"
    Then the error bar says "That annotation is for another thread."
    And BrowserBear's annotation files are gone
