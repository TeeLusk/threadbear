Feature: Giving a thread a Chrome tab with @
  As someone whose agents use my own Chrome through BrowserBear
  I want to type @ in the message box and pick one of my open tabs
  So the agent gets that tab, and how to use it, with my message

  Background:
    Given the app is connected to a runner with the demo threads

  # The Swift app's dump doesn't show its @ picker (AppDump has no tab
  # palette), and it's frozen, so these are checked on the GPUI app only.
  #
  # None run on Windows: BrowserBear is a Mac tool that talks over a Unix
  # socket, which the stand-in can't listen on there (browser-pane.feature).

  @browserbear @windows-pending @browser.tabpicker @swift-pending
  Scenario: Typing @ lists my Chrome tabs, and what I type after it narrows them
    Given my Chrome has "Orders · 7k admin" open at "http://localhost:5173/7k/orders"
    And my Chrome has "YouTube Music" open at "https://music.youtube.com/" on a site agents aren't allowed
    And an agent's own tab "Agent's page" is open at "https://example.com/"
    When I open the thread "Morning brief"
    And I type "Have a look at @" in the composer
    Then the tab picker lists "Orders · 7k admin, YouTube Music"
    And the tab picker shows each tab's icon
    And the tab picker says "Picking gives this chat this tab only" by "YouTube Music"
    When I type "mus" in the composer
    Then the tab picker lists "YouTube Music"
    When I press Escape
    Then the tab picker is closed

  @browserbear @windows-pending @browser.tabpicker @swift-pending
  Scenario: Picking a tab mentions it, lends it at once, and sending adds how to use it
    Given my Chrome has "Orders · 7k admin" open at "http://localhost:5173/7k/orders"
    And my Chrome has "YouTube Music" open at "https://music.youtube.com/" on a site agents aren't allowed
    When I open the thread "Morning brief"
    And I type "Have a look at @" in the composer
    And the tab picker lists "Orders · 7k admin, YouTube Music"
    And I press the down arrow
    And I press Return
    Then the composer says "Have a look at @[YouTube Music](https://music.youtube.com/) (tab 2) "
    And BrowserBear was asked to lend tab 2 to "Morning brief"
    When I type "please" in the composer
    And I press Return
    Then the transcript shows my message "Have a look at @[YouTube Music](https://music.youtube.com/) (tab 2) please"
    And my message in the transcript goes on with "Tab 2 is lent to you: start with browserbear snap 2."

  @browserbear @windows-pending @browser.tabpicker.newthread @swift-pending
  Scenario: A tab picked in the New Thread box is lent once the thread is made
    Given my Chrome has "Orders · 7k admin" open at "http://localhost:5173/7k/orders"
    When I start a new thread
    And I type "Check @ord" in the composer
    And the tab picker lists "Orders · 7k admin"
    And I press Return
    Then the composer says "Check @[Orders · 7k admin](http://localhost:5173/7k/orders) (tab 1) "
    And BrowserBear hasn't been asked to lend a tab
    When I press Return
    Then BrowserBear was asked to lend tab 1 to the new thread
    And my message in the transcript goes on with "I've lent you tab 1 in my Chrome through BrowserBear"

  @browser.tabpicker @swift-pending
  Scenario: Without BrowserBear the picker says so, and Return still sends
    When I open the thread "Morning brief"
    And I type "mail me @" in the composer
    Then the tab picker says "BrowserBear isn't running, so there are no Chrome tabs to pick."
    When I press Return
    Then the transcript shows my message "mail me @"
