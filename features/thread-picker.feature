Feature: Mentioning another thread with #
  As someone whose threads build on each other
  I want to type # in the message box and pick one of my threads
  So a link to it goes in my message, for the agent to read or message it

  Background:
    Given the app is connected to a runner with the demo threads

  # GPUI only: the Swift app has no # picker.

  @thread.picker @swift-pending
  Scenario: Typing # lists my other threads, and what I type narrows them by title or folder
    When I open the thread "Morning brief"
    And I type "See #" in the composer
    Then the thread picker lists "Stop Keep Awake asking for my password"
    And the thread picker doesn't list "Morning brief"
    When I type "photo" in the composer
    Then the thread picker lists only "Tidy up the build scripts, Make uploads resume after a crash"
    When I press Escape
    Then the thread picker is closed

  @thread.picker @swift-pending
  Scenario: Picking a thread puts a link to it in the message
    When I open the thread "Morning brief"
    And I type "Ask #keep" in the composer
    And the thread picker lists only "Stop Keep Awake asking for my password"
    And I press Return
    Then the composer says "Ask [Stop Keep Awake asking for my password](thread:demo_keep_awake) "
    And the thread picker is closed

  @thread.picker @swift-pending
  Scenario: A # with nothing that matches says so, and Return still sends
    When I open the thread "Morning brief"
    And I type "#zzzz" in the composer
    Then the thread picker says "No thread matches #zzzz."
